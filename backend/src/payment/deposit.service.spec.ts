import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DepositStatus } from '@prisma/client';
import Decimal from 'decimal.js';
import { DepositService } from './deposit.service';

// ─── Mock factories ──────────────────────────────────────────────────────────

function makePrisma(overrides: Record<string, any> = {}) {
  return {
    deposit: {
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    ...overrides,
  } as any;
}

function makeWalletService(overrides: Record<string, any> = {}) {
  return {
    getWalletByUserId: jest.fn().mockResolvedValue({ id: 'wallet-1', currency: 'USD', isActive: true, isFrozen: false }),
    assertWalletActive: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as any;
}

function makeTransactionService(overrides: Record<string, any> = {}) {
  return {
    deposit: jest.fn().mockResolvedValue({ transactionId: 'tx-1', reference: 'ref-1' }),
    ...overrides,
  } as any;
}

function makePspSignature(shouldThrow = false) {
  return {
    verify: jest.fn().mockImplementation(() => {
      if (shouldThrow) throw new Error('Bad signature');
    }),
  } as any;
}

function makeSslcommerz(overrides: Record<string, any> = {}) {
  return {
    isConfigured: true,
    createSession: jest.fn().mockResolvedValue({
      gatewayPageUrl: 'https://sandbox.sslcommerz.com/gwprocess/v4/gw.php?Q=pay&sessionkey=sess-key-1',
      sessionKey: 'sess-key-1',
    }),
    validateTransaction: jest.fn(),
    describeChannel: jest.fn().mockReturnValue('bKash'),
    parseGatewayCallbackStatus: jest.fn().mockReturnValue('success'),
    ...overrides,
  } as any;
}

function makeConfig(overrides: Record<string, any> = {}) {
  return {
    get: jest.fn((key: string) => overrides[key]),
  } as any;
}

function makeService({
  prisma = makePrisma(),
  walletService = makeWalletService(),
  transactionService = makeTransactionService(),
  pspSignature = makePspSignature(),
  sslcommerz = makeSslcommerz(),
  config = makeConfig(),
} = {}) {
  return new DepositService(prisma, transactionService, walletService, pspSignature, sslcommerz, config);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('DepositService', () => {
  // ─── initiate ────────────────────────────────────────────────────────────

  describe('initiate', () => {
    it('creates a deposit record and returns depositId + checkoutUrl', async () => {
      const depositId = 'dep-1';
      const prisma = makePrisma();
      prisma.deposit.create.mockResolvedValue({ id: depositId, pspProvider: 'stripe' });
      prisma.deposit.update.mockResolvedValue({});

      const svc = makeService({ prisma });
      const result = await svc.initiate({
        userId: 'user-1',
        amount: '100.00',
        pspProvider: 'stripe',
      });

      expect(result.depositId).toBe(depositId);
      expect(result.checkoutUrl).toContain('stripe');
      expect(result.checkoutUrl).toContain(depositId);
      expect(result.expiresAt).toBeInstanceOf(Date);
    });

    it('persists pspSessionId on the deposit', async () => {
      const prisma = makePrisma();
      prisma.deposit.create.mockResolvedValue({ id: 'dep-1', pspProvider: 'stripe' });
      prisma.deposit.update.mockResolvedValue({});

      const svc = makeService({ prisma });
      await svc.initiate({ userId: 'u1', amount: 50, pspProvider: 'stripe' });

      expect(prisma.deposit.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ pspSessionId: expect.stringContaining('sess_') }),
        }),
      );
    });

    it('stores amount with 8 decimal places', async () => {
      const prisma = makePrisma();
      prisma.deposit.create.mockResolvedValue({ id: 'dep-1', pspProvider: 'stripe' });
      prisma.deposit.update.mockResolvedValue({});

      const svc = makeService({ prisma });
      await svc.initiate({ userId: 'u1', amount: '25.5', pspProvider: 'stripe' });

      expect(prisma.deposit.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ amount: '25.50000000' }),
        }),
      );
    });

    it('throws BadRequestException for amount <= 0', async () => {
      const svc = makeService();
      await expect(svc.initiate({ userId: 'u1', amount: 0, pspProvider: 'stripe' })).rejects.toThrow(
        BadRequestException,
      );
      await expect(svc.initiate({ userId: 'u1', amount: -5, pspProvider: 'stripe' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException for more than 8 decimal places', async () => {
      const svc = makeService();
      await expect(
        svc.initiate({ userId: 'u1', amount: '1.000000001', pspProvider: 'stripe' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('propagates NotFoundException from walletService', async () => {
      const walletService = makeWalletService({
        getWalletByUserId: jest.fn().mockRejectedValue(new NotFoundException('Not found')),
      });
      const svc = makeService({ walletService });
      await expect(svc.initiate({ userId: 'x', amount: 10, pspProvider: 'stripe' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('propagates BadRequestException from assertWalletActive', async () => {
      const walletService = makeWalletService({
        assertWalletActive: jest.fn().mockRejectedValue(new BadRequestException('Wallet frozen')),
      });
      const svc = makeService({ walletService });
      await expect(svc.initiate({ userId: 'u1', amount: 10, pspProvider: 'stripe' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ─── handleWebhook ────────────────────────────────────────────────────────

  describe('handleWebhook', () => {
    it('calls pspSignature.verify with the correct arguments', async () => {
      const pspSignature = makePspSignature();
      const prisma = makePrisma();
      prisma.deposit.findUnique.mockResolvedValue(null);
      const svc = makeService({ prisma, pspSignature });

      const body = Buffer.from(JSON.stringify({ type: 'payment.succeeded', data: { id: 'ref-1' } }));
      await svc.handleWebhook('stripe', 'sig-header', body);

      expect(pspSignature.verify).toHaveBeenCalledWith('stripe', 'sig-header', body);
    });

    it('throws BadRequestException for non-JSON body', async () => {
      const svc = makeService();
      await expect(
        svc.handleWebhook('stripe', '', Buffer.from('not json')),
      ).rejects.toThrow(BadRequestException);
    });

    it('does not throw for unknown event types (silent ignore)', async () => {
      const svc = makeService();
      const body = Buffer.from(JSON.stringify({ type: 'unknown.event', data: {} }));
      await expect(svc.handleWebhook('stripe', '', body)).resolves.not.toThrow();
    });

    it('routes payment.succeeded to settlement', async () => {
      const depositId = 'dep-settle-1';
      const prisma = makePrisma();
      prisma.deposit.findUnique.mockResolvedValue({
        id: depositId,
        userId: 'u1',
        amount: new Decimal('100'),
        currency: 'USD',
        pspProvider: 'stripe',
        status: DepositStatus.PENDING_PAYMENT,
      });
      prisma.deposit.updateMany.mockResolvedValue({ count: 1 });
      prisma.deposit.update.mockResolvedValue({});
      const transactionService = makeTransactionService();

      const svc = makeService({ prisma, transactionService });
      const body = Buffer.from(
        JSON.stringify({
          type: 'payment.succeeded',
          data: { id: 'psp-ref-1', depositId },
        }),
      );
      await svc.handleWebhook('stripe', '', body);

      expect(transactionService.deposit).toHaveBeenCalled();
    });

    it('routes payment.failed to markFailed', async () => {
      const depositId = 'dep-fail-1';
      const prisma = makePrisma();
      prisma.deposit.updateMany.mockResolvedValue({ count: 1 });

      const svc = makeService({ prisma });
      const body = Buffer.from(
        JSON.stringify({
          type: 'payment.failed',
          data: { depositId, failure_reason: 'Declined' },
        }),
      );
      await svc.handleWebhook('stripe', '', body);

      expect(prisma.deposit.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: DepositStatus.FAILED }),
        }),
      );
    });
  });

  // ─── settlement ─────────────────────────────────────────────────────────

  describe('settlement (via handleWebhook payment.succeeded)', () => {
    function buildSuccessBody(depositId: string, pspRef = 'psp-ref-1') {
      return Buffer.from(
        JSON.stringify({ type: 'payment.succeeded', data: { id: pspRef, depositId } }),
      );
    }

    it('marks deposit COMPLETED and links transactionId', async () => {
      const depositId = 'dep-2';
      const prisma = makePrisma();
      prisma.deposit.findUnique.mockResolvedValue({
        id: depositId,
        userId: 'u1',
        amount: new Decimal('50'),
        currency: 'USD',
        pspProvider: 'stripe',
        status: DepositStatus.PENDING_PAYMENT,
      });
      prisma.deposit.updateMany.mockResolvedValue({ count: 1 });
      prisma.deposit.update.mockResolvedValue({});
      const transactionService = makeTransactionService();

      const svc = makeService({ prisma, transactionService });
      await svc.handleWebhook('stripe', '', buildSuccessBody(depositId));

      expect(prisma.deposit.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: DepositStatus.COMPLETED,
            transactionId: 'tx-1',
          }),
        }),
      );
    });

    it('is idempotent: skips if deposit is already COMPLETED', async () => {
      const prisma = makePrisma();
      prisma.deposit.findUnique.mockResolvedValue({
        id: 'dep-3',
        status: DepositStatus.COMPLETED,
      });
      const transactionService = makeTransactionService();

      const svc = makeService({ prisma, transactionService });
      await svc.handleWebhook('stripe', '', buildSuccessBody('dep-3'));

      expect(transactionService.deposit).not.toHaveBeenCalled();
    });

    it('skips if deposit was concurrently claimed (updateMany returns 0)', async () => {
      const prisma = makePrisma();
      prisma.deposit.findUnique.mockResolvedValue({
        id: 'dep-4',
        status: DepositStatus.PENDING_PAYMENT,
        amount: new Decimal('10'),
        currency: 'USD',
        pspProvider: 'stripe',
        userId: 'u1',
      });
      prisma.deposit.updateMany.mockResolvedValue({ count: 0 });
      const transactionService = makeTransactionService();

      const svc = makeService({ prisma, transactionService });
      await svc.handleWebhook('stripe', '', buildSuccessBody('dep-4'));

      expect(transactionService.deposit).not.toHaveBeenCalled();
    });

    it('marks deposit FAILED if transactionService.deposit throws', async () => {
      const depositId = 'dep-5';
      const prisma = makePrisma();
      prisma.deposit.findUnique.mockResolvedValue({
        id: depositId,
        userId: 'u1',
        amount: new Decimal('10'),
        currency: 'USD',
        pspProvider: 'stripe',
        status: DepositStatus.PENDING_PAYMENT,
      });
      prisma.deposit.updateMany.mockResolvedValue({ count: 1 });
      prisma.deposit.update.mockResolvedValue({});
      const transactionService = makeTransactionService({
        deposit: jest.fn().mockRejectedValue(new Error('Wallet not found')),
      });

      const svc = makeService({ prisma, transactionService });
      await svc.handleWebhook('stripe', '', buildSuccessBody(depositId));

      expect(prisma.deposit.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: DepositStatus.FAILED }),
        }),
      );
    });

    it('uses PSP-confirmed amount when it differs from stored amount', async () => {
      const depositId = 'dep-6';
      const prisma = makePrisma();
      prisma.deposit.findUnique.mockResolvedValue({
        id: depositId,
        userId: 'u1',
        amount: new Decimal('100'),
        currency: 'USD',
        pspProvider: 'stripe',
        status: DepositStatus.PENDING_PAYMENT,
      });
      prisma.deposit.updateMany.mockResolvedValue({ count: 1 });
      prisma.deposit.update.mockResolvedValue({});
      const transactionService = makeTransactionService();

      const svc = makeService({ prisma, transactionService });
      const body = Buffer.from(
        JSON.stringify({
          type: 'payment.succeeded',
          data: { id: 'psp-ref-6', depositId, amount: '95.00' },
        }),
      );
      await svc.handleWebhook('stripe', '', body);

      const callArgs = transactionService.deposit.mock.calls[0][0];
      expect(new Decimal(callArgs.amount).toFixed(2)).toBe('95.00');
    });
  });

  // ─── findById / listByUser ────────────────────────────────────────────────

  describe('findById', () => {
    it('returns the deposit when found', async () => {
      const dep = { id: 'dep-1', status: DepositStatus.COMPLETED };
      const prisma = makePrisma();
      prisma.deposit.findUnique.mockResolvedValue(dep);

      const svc = makeService({ prisma });
      await expect(svc.findById('dep-1')).resolves.toBe(dep);
    });

    it('throws NotFoundException when not found', async () => {
      const prisma = makePrisma();
      prisma.deposit.findUnique.mockResolvedValue(null);

      const svc = makeService({ prisma });
      await expect(svc.findById('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('listByUser', () => {
    it('returns paginated deposits for a user', async () => {
      const deposits = [{ id: 'd1' }, { id: 'd2' }];
      const prisma = makePrisma();
      prisma.deposit.findMany.mockResolvedValue(deposits);

      const svc = makeService({ prisma });
      const result = await svc.listByUser('user-1', 0, 10);
      expect(result).toBe(deposits);
      expect(prisma.deposit.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-1' }, skip: 0, take: 10 }),
      );
    });
  });

  // ─── SSLCommerz ────────────────────────────────────────────────────────────

  describe('initiate (sslcommerz provider)', () => {
    it('creates a session via SslcommerzService and returns its GatewayPageURL', async () => {
      const depositId = 'dep-ssl-1';
      const prisma = makePrisma();
      prisma.deposit.create.mockResolvedValue({ id: depositId, pspProvider: 'sslcommerz' });
      prisma.deposit.update.mockResolvedValue({});
      const sslcommerz = makeSslcommerz();

      const svc = makeService({ prisma, sslcommerz });
      const result = await svc.initiate({
        userId: 'user-1',
        amount: '500',
        currency: 'BDT',
        pspProvider: 'sslcommerz',
        mobileGateway: 'BKASH',
        customer: { name: 'Jane', email: 'jane@example.com', phone: '01712345678' },
      });

      expect(sslcommerz.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ tranId: depositId, totalAmount: 500, currency: 'BDT', restrictToGateway: 'BKASH' }),
      );
      expect(result.checkoutUrl).toContain('sslcommerz.com');
      expect(result.depositId).toBe(depositId);
    });

    it('marks the deposit FAILED if SSLCommerz session creation throws', async () => {
      const depositId = 'dep-ssl-2';
      const prisma = makePrisma();
      prisma.deposit.create.mockResolvedValue({ id: depositId, pspProvider: 'sslcommerz' });
      const sslcommerz = makeSslcommerz({
        createSession: jest.fn().mockRejectedValue(new Error('gateway down')),
      });

      const svc = makeService({ prisma, sslcommerz });
      await expect(
        svc.initiate({ userId: 'user-1', amount: '500', pspProvider: 'sslcommerz' }),
      ).rejects.toThrow('gateway down');

      expect(prisma.deposit.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: depositId },
          data: expect.objectContaining({ status: DepositStatus.FAILED }),
        }),
      );
    });
  });

  describe('settleSslcommerzTransaction', () => {
    it('settles the deposit using val_id as the pspReference', async () => {
      const prisma = makePrisma();
      prisma.deposit.findUnique.mockResolvedValue({
        id: 'dep-ssl-1',
        userId: 'user-1',
        status: DepositStatus.PENDING_PAYMENT,
        amount: '500.00000000',
        pspProvider: 'sslcommerz',
      });
      prisma.deposit.updateMany.mockResolvedValue({ count: 1 });
      prisma.deposit.update.mockResolvedValue({});
      const transactionService = makeTransactionService();
      const sslcommerz = makeSslcommerz();

      const svc = makeService({ prisma, transactionService, sslcommerz });
      await svc.settleSslcommerzTransaction({
        tran_id: 'dep-ssl-1',
        val_id: 'val-123',
        amount: '500.00',
        currency: 'BDT',
        status: 'VALID',
        value_a: 'dep-ssl-1',
        card_issuer: 'bKash',
      });

      expect(transactionService.deposit).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', reference: 'deposit:dep-ssl-1' }),
      );
      expect(prisma.deposit.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'dep-ssl-1', status: DepositStatus.PENDING_PAYMENT },
          data: expect.objectContaining({ pspReference: 'val-123' }),
        }),
      );
    });
  });

  describe('markSslcommerzFailed', () => {
    it('marks the deposit resolved from value_a as FAILED', async () => {
      const prisma = makePrisma();
      prisma.deposit.updateMany.mockResolvedValue({ count: 1 });

      const svc = makeService({ prisma });
      await svc.markSslcommerzFailed(
        { tran_id: 'dep-ssl-3', value_a: 'dep-ssl-3', status: 'FAILED' },
        'Customer cancelled at gateway',
      );

      expect(prisma.deposit.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'dep-ssl-3' }),
          data: { status: DepositStatus.FAILED, failureReason: 'Customer cancelled at gateway' },
        }),
      );
    });
  });
});
