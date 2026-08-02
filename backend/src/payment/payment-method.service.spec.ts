import {
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PaymentMethodService } from './payment-method.service';

// ─── Mock factory ────────────────────────────────────────────────────────────
//
// Mirrors the $transaction mocking convention established in
// transaction/transaction.service.spec.ts: the tx client shares the same
// jest.fn()s as the top-level prisma mock's `paymentMethod` model, so
// assertions can check calls made either inside or outside a transaction.

function buildPrismaMock(overrides: Record<string, any> = {}) {
  const paymentMethod = {
    count: jest.fn().mockResolvedValue(0),
    findFirst: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([]),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    delete: jest.fn(),
    ...overrides,
  };

  const txClient = { paymentMethod };

  return {
    paymentMethod,
    $transaction: jest.fn().mockImplementation((fn: (tx: any) => Promise<any>) => fn(txClient)),
  } as any;
}

function makeMethod(overrides: Record<string, any> = {}) {
  return {
    id: 'pm-1',
    userId: 'user-1',
    type: 'BKASH',
    accountNumber: '01712345678',
    accountHolder: null,
    bankName: null,
    branchName: null,
    routingNumber: null,
    label: null,
    isDefault: false,
    isVerified: false,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  } as any;
}

describe('PaymentMethodService', () => {
  // ─── create ────────────────────────────────────────────────────────────

  describe('create', () => {
    it('rejects a mobile wallet account number that is not an 11-digit BD number', async () => {
      const prisma = buildPrismaMock();
      const svc = new PaymentMethodService(prisma);

      await expect(
        svc.create('user-1', { type: 'BKASH' as any, accountNumber: '12345' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a duplicate type+accountNumber for the same user', async () => {
      const prisma = buildPrismaMock({
        findFirst: jest.fn().mockResolvedValue(makeMethod()),
      });
      const svc = new PaymentMethodService(prisma);

      await expect(
        svc.create('user-1', { type: 'BKASH' as any, accountNumber: '01712345678' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('makes the first-ever saved method the default even if makeDefault is not set', async () => {
      const prisma = buildPrismaMock({
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve(makeMethod(data))),
      });
      const svc = new PaymentMethodService(prisma);

      const result = await svc.create('user-1', { type: 'BKASH' as any, accountNumber: '01712345678' });

      expect(result.isDefault).toBe(true);
      // Demoting old defaults still runs (harmlessly, count=0) before create.
      expect(prisma.paymentMethod.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', isDefault: true },
        data: { isDefault: false },
      });
    });

    it('does NOT make a second method default unless makeDefault is explicitly true', async () => {
      const prisma = buildPrismaMock({
        count: jest.fn().mockResolvedValue(1),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve(makeMethod(data))),
      });
      const svc = new PaymentMethodService(prisma);

      const result = await svc.create('user-1', { type: 'NAGAD' as any, accountNumber: '01812345678' });

      expect(result.isDefault).toBe(false);
      expect(prisma.paymentMethod.updateMany).not.toHaveBeenCalled();
    });

    it('demotes the previous default when makeDefault=true on a new method', async () => {
      const prisma = buildPrismaMock({
        count: jest.fn().mockResolvedValue(1),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve(makeMethod(data))),
      });
      const svc = new PaymentMethodService(prisma);

      const result = await svc.create('user-1', {
        type: 'NAGAD' as any,
        accountNumber: '01812345678',
        makeDefault: true,
      });

      expect(result.isDefault).toBe(true);
      expect(prisma.paymentMethod.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', isDefault: true },
        data: { isDefault: false },
      });
    });

    it('allows BANK/CARD account numbers that are not BD mobile format', async () => {
      const prisma = buildPrismaMock({
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve(makeMethod(data))),
      });
      const svc = new PaymentMethodService(prisma);

      await expect(
        svc.create('user-1', { type: 'BANK' as any, accountNumber: 'ACC-1234567890' }),
      ).resolves.toBeDefined();
    });
  });

  // ─── findOwned ─────────────────────────────────────────────────────────

  describe('findOwned', () => {
    it('throws NotFoundException when the method does not exist', async () => {
      const prisma = buildPrismaMock({ findUnique: jest.fn().mockResolvedValue(null) });
      const svc = new PaymentMethodService(prisma);
      await expect(svc.findOwned('missing', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when the method belongs to a different user', async () => {
      const prisma = buildPrismaMock({
        findUnique: jest.fn().mockResolvedValue(makeMethod({ userId: 'someone-else' })),
      });
      const svc = new PaymentMethodService(prisma);
      await expect(svc.findOwned('pm-1', 'user-1')).rejects.toThrow(ForbiddenException);
    });

    it('returns the method when owned by the requesting user', async () => {
      const prisma = buildPrismaMock({ findUnique: jest.fn().mockResolvedValue(makeMethod()) });
      const svc = new PaymentMethodService(prisma);
      await expect(svc.findOwned('pm-1', 'user-1')).resolves.toEqual(makeMethod());
    });
  });

  // ─── setDefault ────────────────────────────────────────────────────────

  describe('setDefault', () => {
    it('is a no-op if the method is already the default', async () => {
      const prisma = buildPrismaMock({
        findUnique: jest.fn().mockResolvedValue(makeMethod({ isDefault: true })),
      });
      const svc = new PaymentMethodService(prisma);

      await svc.setDefault('pm-1', 'user-1');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('demotes the old default and promotes the requested one (exactly one active at a time)', async () => {
      const prisma = buildPrismaMock({
        findUnique: jest.fn().mockResolvedValue(makeMethod({ id: 'pm-2', isDefault: false })),
        update: jest.fn().mockResolvedValue(makeMethod({ id: 'pm-2', isDefault: true })),
      });
      const svc = new PaymentMethodService(prisma);

      const result = await svc.setDefault('pm-2', 'user-1');

      expect(prisma.paymentMethod.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', isDefault: true },
        data: { isDefault: false },
      });
      expect(prisma.paymentMethod.update).toHaveBeenCalledWith({
        where: { id: 'pm-2' },
        data: { isDefault: true },
      });
      expect(result.isDefault).toBe(true);
    });

    it('throws if the method belongs to another user', async () => {
      const prisma = buildPrismaMock({
        findUnique: jest.fn().mockResolvedValue(makeMethod({ userId: 'other-user' })),
      });
      const svc = new PaymentMethodService(prisma);
      await expect(svc.setDefault('pm-1', 'user-1')).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── remove ────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('deletes a non-default method without touching others', async () => {
      const prisma = buildPrismaMock({
        findUnique: jest.fn().mockResolvedValue(makeMethod({ isDefault: false })),
      });
      const svc = new PaymentMethodService(prisma);

      await svc.remove('pm-1', 'user-1');

      expect(prisma.paymentMethod.delete).toHaveBeenCalledWith({ where: { id: 'pm-1' } });
      expect(prisma.paymentMethod.findFirst).not.toHaveBeenCalled();
    });

    it('promotes the most recently created remaining method when the default is removed', async () => {
      const remaining = makeMethod({ id: 'pm-2', isDefault: false });
      const prisma = buildPrismaMock({
        findUnique: jest.fn().mockResolvedValue(makeMethod({ id: 'pm-1', isDefault: true })),
        findFirst: jest.fn().mockResolvedValue(remaining),
      });
      const svc = new PaymentMethodService(prisma);

      await svc.remove('pm-1', 'user-1');

      expect(prisma.paymentMethod.delete).toHaveBeenCalledWith({ where: { id: 'pm-1' } });
      expect(prisma.paymentMethod.findFirst).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: { createdAt: 'desc' },
      });
      expect(prisma.paymentMethod.update).toHaveBeenCalledWith({
        where: { id: 'pm-2' },
        data: { isDefault: true },
      });
    });

    it('does not error when removing the default leaves no other methods', async () => {
      const prisma = buildPrismaMock({
        findUnique: jest.fn().mockResolvedValue(makeMethod({ id: 'pm-1', isDefault: true })),
        findFirst: jest.fn().mockResolvedValue(null),
      });
      const svc = new PaymentMethodService(prisma);

      await expect(svc.remove('pm-1', 'user-1')).resolves.toBeUndefined();
      expect(prisma.paymentMethod.update).not.toHaveBeenCalled();
    });
  });

  // ─── resolveForWithdrawal ──────────────────────────────────────────────

  describe('resolveForWithdrawal', () => {
    it('returns the explicitly requested method when given and owned by the user', async () => {
      const prisma = buildPrismaMock({
        findUnique: jest.fn().mockResolvedValue(makeMethod({ id: 'pm-2' })),
      });
      const svc = new PaymentMethodService(prisma);

      const result = await svc.resolveForWithdrawal('user-1', 'pm-2');
      expect(result.id).toBe('pm-2');
    });

    it('falls back to the current default when no id is given', async () => {
      const prisma = buildPrismaMock({
        findFirst: jest.fn().mockResolvedValue(makeMethod({ id: 'pm-default', isDefault: true })),
      });
      const svc = new PaymentMethodService(prisma);

      const result = await svc.resolveForWithdrawal('user-1');
      expect(result.id).toBe('pm-default');
    });

    it('throws BadRequestException when the user has no payment methods at all', async () => {
      const prisma = buildPrismaMock({ findFirst: jest.fn().mockResolvedValue(null) });
      const svc = new PaymentMethodService(prisma);

      await expect(svc.resolveForWithdrawal('user-1')).rejects.toThrow(BadRequestException);
    });
  });

  // ─── toPayoutSnapshot / maskAccountNumber ──────────────────────────────

  describe('toPayoutSnapshot', () => {
    it('includes the payment method id and type for audit trail purposes', () => {
      const svc = new PaymentMethodService(buildPrismaMock());
      const snapshot = svc.toPayoutSnapshot(makeMethod({ id: 'pm-9', type: 'NAGAD' as any }));
      expect(snapshot).toMatchObject({ paymentMethodId: 'pm-9', type: 'NAGAD' });
    });
  });

  describe('maskAccountNumber (static)', () => {
    it('masks all but the last 4 digits', () => {
      expect(PaymentMethodService.maskAccountNumber('01712345678')).toBe('*******5678');
    });

    it('returns short values unmasked', () => {
      expect(PaymentMethodService.maskAccountNumber('123')).toBe('123');
    });
  });
});
