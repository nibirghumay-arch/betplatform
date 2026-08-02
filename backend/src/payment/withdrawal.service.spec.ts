import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { WithdrawalStatus } from '@prisma/client';
import Decimal from 'decimal.js';
import { WithdrawalService } from './withdrawal.service';

// ─── Mock factories ──────────────────────────────────────────────────────────

function makePrisma(overrides: Record<string, any> = {}) {
  return {
    withdrawal: {
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({ kycVerified: false }),
    },
    ...overrides,
  } as any;
}

function makeWalletService(overrides: Record<string, any> = {}) {
  return {
    getWalletByUserId: jest.fn().mockResolvedValue({
      id: 'wallet-1',
      currency: 'USD',
      isActive: true,
      isFrozen: false,
    }),
    assertWalletActive: jest.fn().mockResolvedValue(undefined),
    getBalance: jest.fn().mockResolvedValue({ balance: '500.00', currency: 'USD' }),
    ...overrides,
  } as any;
}

function makeTransactionService(overrides: Record<string, any> = {}) {
  return {
    withdraw: jest.fn().mockResolvedValue({ transactionId: 'tx-w-1', reference: 'ref-w-1' }),
    ...overrides,
  } as any;
}

function makePspSignature() {
  return { verify: jest.fn() } as any;
}

function makePaymentMethodService(overrides: Record<string, any> = {}) {
  return {
    resolveForWithdrawal: jest.fn().mockResolvedValue({
      id: 'pm-1',
      userId: 'u1',
      type: 'BKASH',
      accountNumber: '01712345678',
    }),
    toPayoutSnapshot: jest.fn().mockReturnValue({
      paymentMethodId: 'pm-1',
      type: 'BKASH',
      accountNumber: '01712345678',
    }),
    ...overrides,
  } as any;
}

function makeWithdrawal(
  id: string,
  status: WithdrawalStatus,
  userId = 'u1',
  amount = '100',
  pspPayoutId?: string,
) {
  return {
    id,
    userId,
    amount: new Decimal(amount),
    currency: 'USD',
    pspProvider: 'stripe',
    status,
    payoutDetails: { iban: 'DE00...' },
    pspPayoutId: pspPayoutId ?? (undefined as string | undefined),
  };
}

function makeService({
  prisma = makePrisma(),
  walletService = makeWalletService(),
  transactionService = makeTransactionService(),
  pspSignature = makePspSignature(),
  paymentMethodService = makePaymentMethodService(),
} = {}) {
  return new WithdrawalService(prisma, transactionService, walletService, pspSignature, paymentMethodService);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('WithdrawalService', () => {
  // ─── request ───────────────────────────────────────────────────────────

  describe('request', () => {
    const baseParams = {
      userId: 'u1',
      amount: '100.00',
      pspProvider: 'stripe',
      payoutDetails: { iban: 'DE00...' },
    };

    it('creates withdrawal with PENDING_KYC when user is not KYC-verified', async () => {
      const prisma = makePrisma();
      prisma.user.findUnique.mockResolvedValue({ kycVerified: false });
      prisma.withdrawal.create.mockResolvedValue({ id: 'w-1', status: WithdrawalStatus.PENDING_KYC });

      const svc = makeService({ prisma });
      const result = await svc.request(baseParams);

      expect(result.status).toBe(WithdrawalStatus.PENDING_KYC);
      expect(prisma.withdrawal.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: WithdrawalStatus.PENDING_KYC }),
        }),
      );
    });

    it('creates withdrawal with PENDING_REVIEW when user is KYC-verified', async () => {
      const prisma = makePrisma();
      prisma.user.findUnique.mockResolvedValue({ kycVerified: true });
      prisma.withdrawal.create.mockResolvedValue({ id: 'w-2', status: WithdrawalStatus.PENDING_REVIEW });

      const svc = makeService({ prisma });
      const result = await svc.request(baseParams);

      expect(result.status).toBe(WithdrawalStatus.PENDING_REVIEW);
    });

    it('throws BadRequestException when balance is insufficient', async () => {
      const walletService = makeWalletService({
        getBalance: jest.fn().mockResolvedValue({ balance: '50.00', currency: 'USD' }),
      });
      const svc = makeService({ walletService });

      await expect(
        svc.request({ ...baseParams, amount: '100.00' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for amount <= 0', async () => {
      const svc = makeService();
      await expect(svc.request({ ...baseParams, amount: '0' })).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for more than 8 decimal places', async () => {
      const svc = makeService();
      await expect(
        svc.request({ ...baseParams, amount: '1.000000001' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('propagates NotFoundException from walletService', async () => {
      const walletService = makeWalletService({
        getWalletByUserId: jest.fn().mockRejectedValue(new NotFoundException('no wallet')),
      });
      const svc = makeService({ walletService });
      await expect(svc.request(baseParams)).rejects.toThrow(NotFoundException);
    });

    it('propagates BadRequestException from assertWalletActive (frozen)', async () => {
      const walletService = makeWalletService({
        assertWalletActive: jest.fn().mockRejectedValue(new BadRequestException('frozen')),
      });
      const svc = makeService({ walletService });
      await expect(svc.request(baseParams)).rejects.toThrow(BadRequestException);
    });

    it('stores amount with 8 decimal places', async () => {
      const prisma = makePrisma();
      prisma.withdrawal.create.mockResolvedValue({ id: 'w-3', status: WithdrawalStatus.PENDING_KYC });

      const svc = makeService({ prisma });
      await svc.request({ ...baseParams, amount: '50' });

      expect(prisma.withdrawal.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ amount: '50.00000000' }),
        }),
      );
    });

    it('resolves the default payment method when pspProvider is sslcommerz and no paymentMethodId given', async () => {
      const prisma = makePrisma();
      prisma.withdrawal.create.mockResolvedValue({ id: 'w-4', status: WithdrawalStatus.PENDING_KYC });
      const paymentMethodService = makePaymentMethodService();

      const svc = makeService({ prisma, paymentMethodService });
      await svc.request({
        userId: 'u1',
        amount: '100.00',
        pspProvider: 'sslcommerz',
      });

      expect(paymentMethodService.resolveForWithdrawal).toHaveBeenCalledWith('u1', undefined);
      expect(prisma.withdrawal.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            paymentMethodId: 'pm-1',
            payoutDetails: expect.objectContaining({ type: 'BKASH' }),
          }),
        }),
      );
    });

    it('resolves a specific payment method when paymentMethodId is given', async () => {
      const prisma = makePrisma();
      prisma.withdrawal.create.mockResolvedValue({ id: 'w-5', status: WithdrawalStatus.PENDING_KYC });
      const paymentMethodService = makePaymentMethodService();

      const svc = makeService({ prisma, paymentMethodService });
      await svc.request({
        userId: 'u1',
        amount: '100.00',
        pspProvider: 'sslcommerz',
        paymentMethodId: 'pm-nagad-1',
      });

      expect(paymentMethodService.resolveForWithdrawal).toHaveBeenCalledWith('u1', 'pm-nagad-1');
    });

    it('falls back to raw payoutDetails for non-mobile-wallet providers without a paymentMethodId', async () => {
      const prisma = makePrisma();
      prisma.withdrawal.create.mockResolvedValue({ id: 'w-6', status: WithdrawalStatus.PENDING_KYC });
      const paymentMethodService = makePaymentMethodService();

      const svc = makeService({ prisma, paymentMethodService });
      await svc.request({ ...baseParams, pspProvider: 'stripe' });

      expect(paymentMethodService.resolveForWithdrawal).not.toHaveBeenCalled();
      expect(prisma.withdrawal.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ payoutDetails: { iban: 'DE00...' } }),
        }),
      );
    });
  });

  // ─── approve ──────────────────────────────────────────────────────────

  describe('approve', () => {
    it('transitions PENDING_REVIEW → PROCESSING and assigns a pspPayoutId', async () => {
      const prisma = makePrisma();
      const w = makeWithdrawal('w-1', WithdrawalStatus.PENDING_REVIEW);
      prisma.withdrawal.findUnique.mockResolvedValue(w);
      prisma.withdrawal.update.mockResolvedValue({});

      const svc = makeService({ prisma });
      await svc.approve('w-1', 'admin-1');

      expect(prisma.withdrawal.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: WithdrawalStatus.PROCESSING,
            reviewedBy: 'admin-1',
            pspPayoutId: expect.stringContaining('payout_'),
          }),
        }),
      );
    });

    it('throws BadRequestException if status is not PENDING_REVIEW', async () => {
      const prisma = makePrisma();
      prisma.withdrawal.findUnique.mockResolvedValue(
        makeWithdrawal('w-1', WithdrawalStatus.PENDING_KYC),
      );

      const svc = makeService({ prisma });
      await expect(svc.approve('w-1', 'admin-1')).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException for unknown withdrawal', async () => {
      const prisma = makePrisma();
      prisma.withdrawal.findUnique.mockResolvedValue(null);

      const svc = makeService({ prisma });
      await expect(svc.approve('missing', 'admin-1')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── reject ───────────────────────────────────────────────────────────

  describe('reject', () => {
    it.each([WithdrawalStatus.PENDING_KYC, WithdrawalStatus.PENDING_REVIEW])(
      'transitions %s → REJECTED with reason',
      async (status) => {
        const prisma = makePrisma();
        prisma.withdrawal.findUnique.mockResolvedValue(makeWithdrawal('w-1', status));
        prisma.withdrawal.update.mockResolvedValue({});

        const svc = makeService({ prisma });
        await svc.reject('w-1', 'admin-1', 'Suspicious activity');

        expect(prisma.withdrawal.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              status: WithdrawalStatus.REJECTED,
              rejectionReason: 'Suspicious activity',
            }),
          }),
        );
      },
    );

    it('throws BadRequestException if status is PROCESSING', async () => {
      const prisma = makePrisma();
      prisma.withdrawal.findUnique.mockResolvedValue(
        makeWithdrawal('w-1', WithdrawalStatus.PROCESSING),
      );

      const svc = makeService({ prisma });
      await expect(svc.reject('w-1', 'admin-1', 'reason')).rejects.toThrow(BadRequestException);
    });
  });

  // ─── cancel ───────────────────────────────────────────────────────────

  describe('cancel', () => {
    it.each([WithdrawalStatus.PENDING_KYC, WithdrawalStatus.PENDING_REVIEW])(
      'transitions %s → CANCELLED',
      async (status) => {
        const prisma = makePrisma();
        prisma.withdrawal.findUnique.mockResolvedValue(makeWithdrawal('w-1', status, 'u1'));
        prisma.withdrawal.update.mockResolvedValue({});

        const svc = makeService({ prisma });
        await svc.cancel('w-1', 'u1');

        expect(prisma.withdrawal.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ status: WithdrawalStatus.CANCELLED }),
          }),
        );
      },
    );

    it('throws ForbiddenException if userId does not match', async () => {
      const prisma = makePrisma();
      prisma.withdrawal.findUnique.mockResolvedValue(
        makeWithdrawal('w-1', WithdrawalStatus.PENDING_KYC, 'u1'),
      );

      const svc = makeService({ prisma });
      await expect(svc.cancel('w-1', 'u-other')).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException if status is PROCESSING', async () => {
      const prisma = makePrisma();
      prisma.withdrawal.findUnique.mockResolvedValue(
        makeWithdrawal('w-1', WithdrawalStatus.PROCESSING, 'u1'),
      );

      const svc = makeService({ prisma });
      await expect(svc.cancel('w-1', 'u1')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException if status is COMPLETED', async () => {
      const prisma = makePrisma();
      prisma.withdrawal.findUnique.mockResolvedValue(
        makeWithdrawal('w-1', WithdrawalStatus.COMPLETED, 'u1'),
      );

      const svc = makeService({ prisma });
      await expect(svc.cancel('w-1', 'u1')).rejects.toThrow(BadRequestException);
    });
  });

  // ─── handleWebhook ────────────────────────────────────────────────────

  describe('handleWebhook', () => {
    it('calls pspSignature.verify', async () => {
      const pspSignature = makePspSignature();
      const prisma = makePrisma();
      prisma.withdrawal.findFirst.mockResolvedValue(null);

      const svc = makeService({ prisma, pspSignature });
      const body = Buffer.from(JSON.stringify({ type: 'payout.paid', data: { id: 'pay-1' } }));
      await svc.handleWebhook('stripe', 'sig-header', body);

      expect(pspSignature.verify).toHaveBeenCalledWith('stripe', 'sig-header', body);
    });

    it('throws BadRequestException for non-JSON body', async () => {
      const svc = makeService();
      await expect(
        svc.handleWebhook('stripe', '', Buffer.from('not json')),
      ).rejects.toThrow(BadRequestException);
    });

    it('does not throw for unknown event types', async () => {
      const svc = makeService();
      const body = Buffer.from(JSON.stringify({ type: 'unknown.event', data: {} }));
      await expect(svc.handleWebhook('stripe', '', body)).resolves.not.toThrow();
    });

    it('routes payout.paid to settlement', async () => {
      const prisma = makePrisma();
      const w = makeWithdrawal('w-1', WithdrawalStatus.PROCESSING, 'u1', '100', 'payout_abc');
      prisma.withdrawal.findFirst.mockResolvedValue(w);
      prisma.withdrawal.update.mockResolvedValue({});
      const transactionService = makeTransactionService();

      const svc = makeService({ prisma, transactionService });
      const body = Buffer.from(
        JSON.stringify({ type: 'payout.paid', data: { id: 'payout_abc' } }),
      );
      await svc.handleWebhook('stripe', '', body);

      expect(transactionService.withdraw).toHaveBeenCalled();
    });

    it('routes payout.failed to markFailed', async () => {
      const prisma = makePrisma();
      prisma.withdrawal.findFirst.mockResolvedValue(
        makeWithdrawal('w-1', WithdrawalStatus.PROCESSING),
      );
      prisma.withdrawal.updateMany.mockResolvedValue({ count: 1 });

      const svc = makeService({ prisma });
      const body = Buffer.from(
        JSON.stringify({
          type: 'payout.failed',
          data: { id: 'payout_abc', failure_reason: 'Account closed' },
        }),
      );
      await svc.handleWebhook('stripe', '', body);

      expect(prisma.withdrawal.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: WithdrawalStatus.FAILED }),
        }),
      );
    });
  });

  // ─── settlement ──────────────────────────────────────────────────────

  describe('settlement (via handleWebhook payout.paid)', () => {
    function buildPayoutBody(pspPayoutId: string) {
      return Buffer.from(JSON.stringify({ type: 'payout.paid', data: { id: pspPayoutId } }));
    }

    it('calls transactionService.withdraw and marks withdrawal COMPLETED', async () => {
      const w = makeWithdrawal('w-1', WithdrawalStatus.PROCESSING, 'u1', '100');
      (w as any).pspPayoutId = 'payout_1';
      const prisma = makePrisma();
      prisma.withdrawal.findFirst.mockResolvedValue(w);
      prisma.withdrawal.update.mockResolvedValue({});
      const transactionService = makeTransactionService();

      const svc = makeService({ prisma, transactionService });
      await svc.handleWebhook('stripe', '', buildPayoutBody('payout_1'));

      expect(transactionService.withdraw).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          reference: `withdrawal:w-1`,
        }),
      );
      expect(prisma.withdrawal.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: WithdrawalStatus.COMPLETED,
            transactionId: 'tx-w-1',
          }),
        }),
      );
    });

    it('is idempotent: skips if withdrawal already COMPLETED', async () => {
      const w = makeWithdrawal('w-2', WithdrawalStatus.COMPLETED);
      (w as any).pspPayoutId = 'payout_2';
      const prisma = makePrisma();
      prisma.withdrawal.findFirst.mockResolvedValue(w);
      const transactionService = makeTransactionService();

      const svc = makeService({ prisma, transactionService });
      await svc.handleWebhook('stripe', '', buildPayoutBody('payout_2'));

      expect(transactionService.withdraw).not.toHaveBeenCalled();
    });

    it('marks FAILED if transactionService.withdraw throws (insufficient funds)', async () => {
      const w = makeWithdrawal('w-3', WithdrawalStatus.PROCESSING, 'u1', '999999');
      (w as any).pspPayoutId = 'payout_3';
      const prisma = makePrisma();
      prisma.withdrawal.findFirst.mockResolvedValue(w);
      prisma.withdrawal.updateMany.mockResolvedValue({ count: 1 });
      const transactionService = makeTransactionService({
        withdraw: jest.fn().mockRejectedValue(new BadRequestException('Insufficient funds')),
      });

      const svc = makeService({ prisma, transactionService });
      await svc.handleWebhook('stripe', '', buildPayoutBody('payout_3'));

      expect(prisma.withdrawal.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: WithdrawalStatus.FAILED }),
        }),
      );
    });

    it('skips if withdrawal is not in PROCESSING status', async () => {
      const w = makeWithdrawal('w-4', WithdrawalStatus.PENDING_REVIEW);
      (w as any).pspPayoutId = 'payout_4';
      const prisma = makePrisma();
      prisma.withdrawal.findFirst.mockResolvedValue(w);
      const transactionService = makeTransactionService();

      const svc = makeService({ prisma, transactionService });
      await svc.handleWebhook('stripe', '', buildPayoutBody('payout_4'));

      expect(transactionService.withdraw).not.toHaveBeenCalled();
    });
  });

  // ─── getAdminQueue ────────────────────────────────────────────────────

  describe('getAdminQueue', () => {
    it('defaults to PENDING_REVIEW and sorts oldest-first', async () => {
      const prisma = makePrisma();
      prisma.withdrawal.findMany.mockResolvedValue([]);

      const svc = makeService({ prisma });
      await svc.getAdminQueue();

      expect(prisma.withdrawal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: WithdrawalStatus.PENDING_REVIEW },
          orderBy: { createdAt: 'asc' },
        }),
      );
    });

    it('accepts a custom status filter', async () => {
      const prisma = makePrisma();
      prisma.withdrawal.findMany.mockResolvedValue([]);

      const svc = makeService({ prisma });
      await svc.getAdminQueue(WithdrawalStatus.PENDING_KYC, 0, 25);

      expect(prisma.withdrawal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: WithdrawalStatus.PENDING_KYC },
          take: 25,
        }),
      );
    });
  });

  // ─── findById ─────────────────────────────────────────────────────────

  describe('findById', () => {
    it('returns the withdrawal when found', async () => {
      const w = makeWithdrawal('w-1', WithdrawalStatus.PENDING_KYC);
      const prisma = makePrisma();
      prisma.withdrawal.findUnique.mockResolvedValue(w);

      const svc = makeService({ prisma });
      await expect(svc.findById('w-1')).resolves.toBe(w);
    });

    it('throws NotFoundException when not found', async () => {
      const prisma = makePrisma();
      prisma.withdrawal.findUnique.mockResolvedValue(null);

      const svc = makeService({ prisma });
      await expect(svc.findById('missing')).rejects.toThrow(NotFoundException);
    });
  });
});
