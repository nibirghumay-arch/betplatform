import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ReferralRewardStatus } from '@prisma/client';
import { ReferralService } from './referral.service';

// ─── Mock factories ───────────────────────────────────────────────────────────

function makePrisma(overrides: Record<string, any> = {}) {
  return {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    referral: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    referralReward: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    ...overrides,
  } as any;
}

function makeSettings(overrides: Record<string, any> = {}) {
  return {
    getNumber: jest.fn().mockImplementation((key: string, def: number) => Promise.resolve(def)),
    getString: jest.fn(),
    get: jest.fn(),
    ...overrides,
  } as any;
}

function makeTransactionService(overrides: Record<string, any> = {}) {
  return {
    bonusCredit: jest.fn().mockResolvedValue({ transactionId: 'tx-1' }),
    ...overrides,
  } as any;
}

function makeEventEmitter() {
  return { emit: jest.fn() } as any;
}

function makeService({
  prisma = makePrisma(),
  settings = makeSettings(),
  transactionService = makeTransactionService(),
  eventEmitter = makeEventEmitter(),
} = {}) {
  return new ReferralService(prisma, settings, transactionService, eventEmitter);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ReferralService', () => {
  // ─── generateCode ──────────────────────────────────────────────────────────

  describe('generateCode', () => {
    it('returns existing code if user already has one', async () => {
      const prisma = makePrisma();
      prisma.user.findUnique.mockResolvedValue({ referralCode: 'EXISTING123' });

      const svc = makeService({ prisma });
      const code = await svc.generateCode('user-1');

      expect(code).toBe('EXISTING123');
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('generates and persists a new code if none exists', async () => {
      const prisma = makePrisma();
      prisma.user.findUnique.mockResolvedValue({ referralCode: null });
      prisma.user.update.mockResolvedValue({});

      const svc = makeService({ prisma });
      const code = await svc.generateCode('user-1');

      expect(typeof code).toBe('string');
      expect(code.length).toBeGreaterThan(4);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { referralCode: code } }),
      );
    });

    it('throws NotFoundException when user not found', async () => {
      const prisma = makePrisma();
      prisma.user.findUnique.mockResolvedValue(null);

      const svc = makeService({ prisma });
      await expect(svc.generateCode('missing')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── applyReferralCode ─────────────────────────────────────────────────────

  describe('applyReferralCode', () => {
    it('creates a referral link when code is valid', async () => {
      const prisma = makePrisma();
      prisma.user.findUnique.mockResolvedValue({ id: 'referrer-1' });
      prisma.referral.findUnique.mockResolvedValue(null);
      prisma.referral.create.mockResolvedValue({});

      const svc = makeService({ prisma });
      await svc.applyReferralCode('new-user-1', 'VALIDCODE');

      expect(prisma.referral.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ referrerId: 'referrer-1', referredId: 'new-user-1' }),
        }),
      );
    });

    it('throws NotFoundException for unknown referral code', async () => {
      const prisma = makePrisma();
      prisma.user.findUnique.mockResolvedValue(null);

      const svc = makeService({ prisma });
      await expect(svc.applyReferralCode('u1', 'BADCODE')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when user tries to refer themselves', async () => {
      const prisma = makePrisma();
      prisma.user.findUnique.mockResolvedValue({ id: 'self-1' });

      const svc = makeService({ prisma });
      await expect(svc.applyReferralCode('self-1', 'SELFCODE')).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when user has already been referred', async () => {
      const prisma = makePrisma();
      prisma.user.findUnique.mockResolvedValue({ id: 'referrer-1' });
      prisma.referral.findUnique.mockResolvedValue({ id: 'existing-ref' });

      const svc = makeService({ prisma });
      await expect(svc.applyReferralCode('already-referred', 'CODE')).rejects.toThrow(ConflictException);
    });
  });

  // ─── processDepositCommission ──────────────────────────────────────────────

  describe('processDepositCommission', () => {
    it('does nothing when user was not referred', async () => {
      const prisma = makePrisma();
      prisma.referral.findUnique.mockResolvedValue(null);
      const transactionService = makeTransactionService();

      const svc = makeService({ prisma, transactionService });
      await svc.processDepositCommission('u1', '100');

      expect(transactionService.bonusCredit).not.toHaveBeenCalled();
    });

    it('does nothing when commission was already paid', async () => {
      const prisma = makePrisma();
      prisma.referral.findUnique.mockResolvedValue({ id: 'ref-1', referrerId: 'r1', referredId: 'u1' });
      prisma.referralReward.findFirst.mockResolvedValue({ id: 'reward-1' });
      const transactionService = makeTransactionService();

      const svc = makeService({ prisma, transactionService });
      await svc.processDepositCommission('u1', '100');

      expect(transactionService.bonusCredit).not.toHaveBeenCalled();
    });

    it('pays commission to referrer based on commission rate setting', async () => {
      const prisma = makePrisma();
      prisma.referral.findUnique.mockResolvedValue({ id: 'ref-1', referrerId: 'referrer-1', referredId: 'u1' });
      prisma.referralReward.findFirst.mockResolvedValue(null);
      prisma.referralReward.create.mockResolvedValue({ id: 'reward-1' });
      prisma.referralReward.update.mockResolvedValue({});
      prisma.referral.update.mockResolvedValue({});
      const transactionService = makeTransactionService();
      const settings = makeSettings({
        getNumber: jest.fn().mockImplementation((key: string, def: number) => {
          if (key === 'referral.commission_rate') return Promise.resolve(0.1);
          return Promise.resolve(0);
        }),
      });

      const svc = makeService({ prisma, transactionService, settings });
      await svc.processDepositCommission('u1', '200');

      // 10% of 200 = 20
      const call = transactionService.bonusCredit.mock.calls[0][0];
      expect(call.amount.toFixed(2)).toBe('20.00');
      expect(call.userId).toBe('referrer-1');
    });

    it('also pays flat referrer bonus when setting > 0', async () => {
      const prisma = makePrisma();
      prisma.referral.findUnique.mockResolvedValue({ id: 'ref-1', referrerId: 'r1', referredId: 'u1' });
      prisma.referralReward.findFirst.mockResolvedValue(null);
      prisma.referralReward.create.mockResolvedValue({ id: 'reward-1' });
      prisma.referralReward.update.mockResolvedValue({});
      prisma.referral.update.mockResolvedValue({});
      const transactionService = makeTransactionService();
      const settings = makeSettings({
        getNumber: jest.fn().mockImplementation((key: string, def: number) => {
          if (key === 'referral.commission_rate') return Promise.resolve(0.05);
          if (key === 'referral.referrer_bonus_amount') return Promise.resolve(25);
          return Promise.resolve(0);
        }),
      });

      const svc = makeService({ prisma, transactionService, settings });
      await svc.processDepositCommission('u1', '100');

      // Called twice: commission + flat bonus
      expect(transactionService.bonusCredit).toHaveBeenCalledTimes(2);
    });

    it('also pays referred user bonus when setting > 0', async () => {
      const prisma = makePrisma();
      prisma.referral.findUnique.mockResolvedValue({ id: 'ref-1', referrerId: 'r1', referredId: 'u1' });
      prisma.referralReward.findFirst.mockResolvedValue(null);
      prisma.referralReward.create.mockResolvedValue({ id: 'rw-1' });
      prisma.referralReward.update.mockResolvedValue({});
      prisma.referral.update.mockResolvedValue({});
      const transactionService = makeTransactionService();
      const settings = makeSettings({
        getNumber: jest.fn().mockImplementation((key: string) => {
          if (key === 'referral.commission_rate') return Promise.resolve(0.05);
          if (key === 'referral.referred_bonus_amount') return Promise.resolve(10);
          return Promise.resolve(0);
        }),
      });

      const svc = makeService({ prisma, transactionService, settings });
      await svc.processDepositCommission('u1', '100');

      // Called twice: referrer commission + referred bonus
      expect(transactionService.bonusCredit).toHaveBeenCalledTimes(2);
      const calls = transactionService.bonusCredit.mock.calls;
      const receiverIds = calls.map((c: any) => c[0].userId);
      expect(receiverIds).toContain('u1');
    });

    it('marks reward CANCELLED and logs error when bonusCredit throws', async () => {
      const prisma = makePrisma();
      prisma.referral.findUnique.mockResolvedValue({ id: 'ref-1', referrerId: 'r1', referredId: 'u1' });
      prisma.referralReward.findFirst.mockResolvedValue(null);
      prisma.referralReward.create.mockResolvedValue({ id: 'rw-1' });
      prisma.referralReward.update.mockResolvedValue({});
      prisma.referral.update.mockResolvedValue({});
      const transactionService = makeTransactionService({
        bonusCredit: jest.fn().mockRejectedValue(new Error('Wallet frozen')),
      });

      const svc = makeService({ prisma, transactionService });
      // Should not throw — failures are swallowed and logged
      await expect(svc.processDepositCommission('u1', '100')).resolves.not.toThrow();

      expect(prisma.referralReward.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: ReferralRewardStatus.CANCELLED } }),
      );
    });

    it('emits REFERRAL_DEPOSIT_COMPLETED event on success', async () => {
      const prisma = makePrisma();
      prisma.referral.findUnique.mockResolvedValue({ id: 'ref-1', referrerId: 'r1', referredId: 'u1' });
      prisma.referralReward.findFirst.mockResolvedValue(null);
      prisma.referralReward.create.mockResolvedValue({ id: 'rw-1' });
      prisma.referralReward.update.mockResolvedValue({});
      prisma.referral.update.mockResolvedValue({});
      const eventEmitter = makeEventEmitter();

      const svc = makeService({ prisma, eventEmitter });
      await svc.processDepositCommission('u1', '100');

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'referral.deposit.completed',
        expect.objectContaining({ referrerId: 'r1', referredId: 'u1' }),
      );
    });
  });

  // ─── getMyCode ─────────────────────────────────────────────────────────────

  describe('getMyCode', () => {
    it('returns existing code without generating a new one', async () => {
      const prisma = makePrisma();
      prisma.user.findUnique.mockResolvedValue({ referralCode: 'ABC123' });

      const svc = makeService({ prisma });
      const code = await svc.getMyCode('user-1');
      expect(code).toBe('ABC123');
    });

    it('auto-generates a code when user has none', async () => {
      const prisma = makePrisma();
      // First call: getMyCode lookup → no code
      // Second call inside generateCode → no code
      prisma.user.findUnique.mockResolvedValue({ referralCode: null });
      prisma.user.update.mockResolvedValue({});

      const svc = makeService({ prisma });
      const code = await svc.getMyCode('user-1');
      expect(typeof code).toBe('string');
    });
  });
});
