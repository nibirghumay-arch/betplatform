import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BonusStatus, BonusType } from '@prisma/client';
import Decimal from 'decimal.js';
import { BonusService } from './bonus.service';

// ─── Mock factories ───────────────────────────────────────────────────────────

function makePrisma(overrides: Record<string, any> = {}) {
  return {
    bonus: {
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    bonusClaim: {
      create: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    bonusRule: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    ...overrides,
  } as any;
}

function makeTransactionService(overrides: Record<string, any> = {}) {
  return {
    bonusCredit: jest.fn().mockResolvedValue({ transactionId: 'tx-bonus-1' }),
    bonusDebit: jest.fn().mockResolvedValue({ transactionId: 'tx-debit-1' }),
    ...overrides,
  } as any;
}

function makeService({ prisma = makePrisma(), transactionService = makeTransactionService() } = {}) {
  return new BonusService(prisma, transactionService);
}

function makeBonus(overrides: Record<string, any> = {}) {
  return {
    id: 'bonus-1',
    userId: 'u1',
    bonusType: BonusType.WELCOME,
    status: BonusStatus.ACTIVE,
    amount: new Decimal('100'),
    wageringRequirement: new Decimal('3000'),
    wageredAmount: new Decimal('0'),
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('BonusService', () => {
  // ─── grant ─────────────────────────────────────────────────────────────────

  describe('grant', () => {
    it('creates bonus record and calls bonusCredit', async () => {
      const prisma = makePrisma();
      prisma.bonus.create.mockResolvedValue({ id: 'bonus-1' });
      prisma.bonus.update.mockResolvedValue({});
      const transactionService = makeTransactionService();

      const svc = makeService({ prisma, transactionService });
      await svc.grant({
        userId: 'u1',
        bonusType: BonusType.WELCOME,
        amount: new Decimal('100'),
        wageringRequirement: new Decimal('3000'),
      });

      expect(prisma.bonus.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'u1',
            bonusType: BonusType.WELCOME,
            status: BonusStatus.ACTIVE,
            amount: '100.00000000',
          }),
        }),
      );
      expect(transactionService.bonusCredit).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u1', reference: 'bonus:bonus-1' }),
      );
    });

    it('creates a BonusClaim record when bonusRuleId is provided', async () => {
      const prisma = makePrisma();
      prisma.bonus.create.mockResolvedValue({ id: 'bonus-2' });
      prisma.bonus.update.mockResolvedValue({});

      const svc = makeService({ prisma });
      await svc.grant({
        userId: 'u1',
        bonusType: BonusType.DEPOSIT,
        bonusRuleId: 'rule-1',
        amount: new Decimal('50'),
        wageringRequirement: new Decimal('1250'),
      });

      expect(prisma.bonusClaim.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'u1', bonusRuleId: 'rule-1', bonusId: 'bonus-2' }),
        }),
      );
    });

    it('cancels bonus and rethrows when bonusCredit fails', async () => {
      const prisma = makePrisma();
      prisma.bonus.create.mockResolvedValue({ id: 'bonus-3' });
      prisma.bonus.update.mockResolvedValue({});
      const transactionService = makeTransactionService({
        bonusCredit: jest.fn().mockRejectedValue(new Error('Wallet not found')),
      });

      const svc = makeService({ prisma, transactionService });
      await expect(
        svc.grant({ userId: 'u1', bonusType: BonusType.WELCOME, amount: new Decimal('100'), wageringRequirement: new Decimal('3000') }),
      ).rejects.toThrow('Wallet not found');

      expect(prisma.bonus.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: BonusStatus.CANCELLED }) }),
      );
    });

    it('stores expiresAt when expiryDays-derived date is provided', async () => {
      const prisma = makePrisma();
      prisma.bonus.create.mockResolvedValue({ id: 'bonus-4' });
      prisma.bonus.update.mockResolvedValue({});

      const expiry = new Date(Date.now() + 30 * 86400_000);
      const svc = makeService({ prisma });
      await svc.grant({
        userId: 'u1',
        bonusType: BonusType.WELCOME,
        amount: new Decimal('100'),
        wageringRequirement: new Decimal('3000'),
        expiresAt: expiry,
      });

      expect(prisma.bonus.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ expiresAt: expiry }),
        }),
      );
    });
  });

  // ─── recordWagering ────────────────────────────────────────────────────────

  describe('recordWagering', () => {
    it('accumulates wager on active bonuses', async () => {
      const prisma = makePrisma();
      prisma.bonus.findMany.mockResolvedValue([makeBonus({ wageredAmount: new Decimal('500') })]);
      prisma.bonus.update.mockResolvedValue({});

      const svc = makeService({ prisma });
      await svc.recordWagering('u1', '200');

      expect(prisma.bonus.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            wageredAmount: '700.00000000',
            status: BonusStatus.WAGERING,
          }),
        }),
      );
    });

    it('marks bonus COMPLETED when wagering requirement is met', async () => {
      const prisma = makePrisma();
      prisma.bonus.findMany.mockResolvedValue([
        makeBonus({ wageredAmount: new Decimal('2900'), wageringRequirement: new Decimal('3000') }),
      ]);
      prisma.bonus.update.mockResolvedValue({});

      const svc = makeService({ prisma });
      await svc.recordWagering('u1', '200'); // 2900 + 200 = 3100 ≥ 3000

      expect(prisma.bonus.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: BonusStatus.COMPLETED,
            completedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('handles multiple active bonuses independently', async () => {
      const prisma = makePrisma();
      prisma.bonus.findMany.mockResolvedValue([
        makeBonus({ id: 'b1', wageredAmount: new Decimal('100'), wageringRequirement: new Decimal('3000') }),
        makeBonus({ id: 'b2', wageredAmount: new Decimal('2900'), wageringRequirement: new Decimal('3000') }),
      ]);
      prisma.bonus.update.mockResolvedValue({});

      const svc = makeService({ prisma });
      await svc.recordWagering('u1', '200');

      const calls = prisma.bonus.update.mock.calls;
      const statuses = calls.map((c: any) => c[0].data.status);
      expect(statuses).toContain(BonusStatus.WAGERING);
      expect(statuses).toContain(BonusStatus.COMPLETED);
    });

    it('does nothing when user has no active bonuses', async () => {
      const prisma = makePrisma();
      prisma.bonus.findMany.mockResolvedValue([]);
      prisma.bonus.update.mockResolvedValue({});

      const svc = makeService({ prisma });
      await svc.recordWagering('u1', '100');

      expect(prisma.bonus.update).not.toHaveBeenCalled();
    });
  });

  // ─── expireOverdueBonuses ──────────────────────────────────────────────────

  describe('expireOverdueBonuses', () => {
    it('updates expired bonuses and returns count', async () => {
      const prisma = makePrisma();
      prisma.bonus.updateMany.mockResolvedValue({ count: 3 });

      const svc = makeService({ prisma });
      const count = await svc.expireOverdueBonuses();

      expect(count).toBe(3);
      expect(prisma.bonus.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: BonusStatus.EXPIRED },
        }),
      );
    });

    it('returns 0 when nothing expired', async () => {
      const prisma = makePrisma();
      prisma.bonus.updateMany.mockResolvedValue({ count: 0 });

      const svc = makeService({ prisma });
      expect(await svc.expireOverdueBonuses()).toBe(0);
    });
  });

  // ─── forfeit ───────────────────────────────────────────────────────────────

  describe('forfeit', () => {
    it('debits remaining bonus amount and marks FORFEITED', async () => {
      const prisma = makePrisma();
      prisma.bonus.findUnique.mockResolvedValue(
        makeBonus({ amount: new Decimal('100'), wageredAmount: new Decimal('40') }),
      );
      prisma.bonus.update.mockResolvedValue({});
      const transactionService = makeTransactionService();

      const svc = makeService({ prisma, transactionService });
      await svc.forfeit('bonus-1', 'admin-1');

      // remaining = 100 - 40 = 60
      const call = transactionService.bonusDebit.mock.calls[0][0];
      expect(new Decimal(call.amount).toFixed(2)).toBe('60.00');
      expect(prisma.bonus.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: BonusStatus.FORFEITED } }),
      );
    });

    it('does not call bonusDebit when remaining amount is zero', async () => {
      const prisma = makePrisma();
      prisma.bonus.findUnique.mockResolvedValue(
        makeBonus({ amount: new Decimal('100'), wageredAmount: new Decimal('100') }),
      );
      prisma.bonus.update.mockResolvedValue({});
      const transactionService = makeTransactionService();

      const svc = makeService({ prisma, transactionService });
      await svc.forfeit('bonus-1', 'admin-1');

      expect(transactionService.bonusDebit).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for unknown bonus', async () => {
      const prisma = makePrisma();
      prisma.bonus.findUnique.mockResolvedValue(null);

      const svc = makeService({ prisma });
      await expect(svc.forfeit('missing', 'admin')).rejects.toThrow(NotFoundException);
    });

    it.each([BonusStatus.COMPLETED, BonusStatus.FORFEITED])(
      'throws BadRequestException when bonus is already %s',
      async (status) => {
        const prisma = makePrisma();
        prisma.bonus.findUnique.mockResolvedValue(makeBonus({ status }));

        const svc = makeService({ prisma });
        await expect(svc.forfeit('bonus-1', 'admin')).rejects.toThrow(BadRequestException);
      },
    );
  });

  // ─── toggleBonusRule ───────────────────────────────────────────────────────

  describe('toggleBonusRule', () => {
    it('activates a rule', async () => {
      const prisma = makePrisma();
      prisma.bonusRule.findUnique.mockResolvedValue({ id: 'rule-1', isActive: false });
      prisma.bonusRule.update.mockResolvedValue({});

      const svc = makeService({ prisma });
      await svc.toggleBonusRule('rule-1', true);

      expect(prisma.bonusRule.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isActive: true } }),
      );
    });

    it('throws NotFoundException for unknown rule', async () => {
      const prisma = makePrisma();
      prisma.bonusRule.findUnique.mockResolvedValue(null);

      const svc = makeService({ prisma });
      await expect(svc.toggleBonusRule('missing', true)).rejects.toThrow(NotFoundException);
    });
  });
});
