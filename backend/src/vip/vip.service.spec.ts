import { NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { VipService } from './vip.service';

// ─── Mock factories ───────────────────────────────────────────────────────────

function makePrisma(overrides: Record<string, any> = {}) {
  return {
    vipProgress: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    vipLevel: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    ...overrides,
  } as any;
}

function makeEventEmitter() {
  return { emit: jest.fn() } as any;
}

function makeService({ prisma = makePrisma(), eventEmitter = makeEventEmitter() } = {}) {
  return new VipService(prisma, eventEmitter);
}

function makeProgress(overrides: Record<string, any> = {}) {
  return {
    userId: 'u1',
    currentTier: 0,
    totalWagerUsd: new Decimal(0),
    periodWagerUsd: new Decimal(0),
    lastPromotedAt: null,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('VipService', () => {
  // ─── recordWager ───────────────────────────────────────────────────────────

  describe('recordWager', () => {
    it('creates progress record if none exists', async () => {
      const prisma = makePrisma();
      prisma.vipProgress.findUnique.mockResolvedValueOnce(null);
      prisma.vipProgress.create.mockResolvedValue(makeProgress());
      prisma.vipProgress.update.mockResolvedValue({});

      const svc = makeService({ prisma });
      await svc.recordWager('u1', '50');

      expect(prisma.vipProgress.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'u1', currentTier: 0 }),
        }),
      );
    });

    it('accumulates wager on existing progress', async () => {
      const prisma = makePrisma();
      prisma.vipProgress.findUnique.mockResolvedValue(
        makeProgress({ totalWagerUsd: new Decimal('200'), periodWagerUsd: new Decimal('200') }),
      );
      prisma.vipProgress.update.mockResolvedValue({});

      const svc = makeService({ prisma });
      await svc.recordWager('u1', '50');

      expect(prisma.vipProgress.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ totalWagerUsd: '250.00', periodWagerUsd: '250.00' }),
        }),
      );
    });

    it('does not promote when no qualifying tier exists', async () => {
      const prisma = makePrisma();
      prisma.vipProgress.findUnique.mockResolvedValue(makeProgress({ totalWagerUsd: new Decimal('50') }));
      prisma.vipLevel.findMany.mockResolvedValue([]);
      prisma.vipProgress.update.mockResolvedValue({});
      const eventEmitter = makeEventEmitter();

      const svc = makeService({ prisma, eventEmitter });
      await svc.recordWager('u1', '50');

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('promotes user when total wager crosses tier threshold', async () => {
      const prisma = makePrisma();
      prisma.vipProgress.findUnique.mockResolvedValue(
        makeProgress({ currentTier: 0, totalWagerUsd: new Decimal('900') }),
      );
      const tier1 = { tier: 1, name: 'Silver', minWagerUsd: new Decimal('1000'), bonusAmount: new Decimal('50') };
      prisma.vipLevel.findMany.mockResolvedValue([tier1]);
      prisma.vipProgress.update.mockResolvedValue({});
      const eventEmitter = makeEventEmitter();

      const svc = makeService({ prisma, eventEmitter });
      await svc.recordWager('u1', '150'); // 900 + 150 = 1050 ≥ 1000

      expect(prisma.vipProgress.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ currentTier: 1 }),
        }),
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'vip.tier.promoted',
        expect.objectContaining({ userId: 'u1', newTier: 1 }),
      );
    });

    it('promotes to highest qualifying tier in one step', async () => {
      const prisma = makePrisma();
      prisma.vipProgress.findUnique.mockResolvedValue(
        makeProgress({ currentTier: 0, totalWagerUsd: new Decimal('0') }),
      );
      const tier2 = { tier: 2, name: 'Gold', minWagerUsd: new Decimal('500'), bonusAmount: new Decimal('100') };
      // findMany returns highest qualifying tier (desc order, take 1)
      prisma.vipLevel.findMany.mockResolvedValue([tier2]);
      prisma.vipProgress.update.mockResolvedValue({});
      const eventEmitter = makeEventEmitter();

      const svc = makeService({ prisma, eventEmitter });
      await svc.recordWager('u1', '600');

      expect(prisma.vipProgress.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ currentTier: 2 }),
        }),
      );
    });

    it('swallows errors from event listener path (onBetPlaced)', async () => {
      const prisma = makePrisma();
      prisma.vipProgress.findUnique.mockRejectedValue(new Error('DB error'));

      const svc = makeService({ prisma });
      await expect(svc.onBetPlaced({ userId: 'u1', amount: '10', currency: 'USD', gameRoundId: 'r1' })).resolves.not.toThrow();
    });
  });

  // ─── getUserProgress ───────────────────────────────────────────────────────

  describe('getUserProgress', () => {
    it('returns existing progress with vipLevel included', async () => {
      const prisma = makePrisma();
      const progress = makeProgress({ vipLevel: { tier: 1, name: 'Silver' } });
      prisma.vipProgress.findUnique.mockResolvedValue(progress);

      const svc = makeService({ prisma });
      const result = await svc.getUserProgress('u1');
      expect(result).toBe(progress);
    });

    it('creates and returns progress for new user', async () => {
      const prisma = makePrisma();
      const created = makeProgress({ vipLevel: null });
      prisma.vipProgress.findUnique
        .mockResolvedValueOnce(null)   // getUserProgress: not found
        .mockResolvedValueOnce(null)   // getOrCreateProgress: not found → triggers create
        .mockResolvedValueOnce(created); // getUserProgress second findUnique after create
      prisma.vipProgress.create.mockResolvedValue(makeProgress());

      const svc = makeService({ prisma });
      const result = await svc.getUserProgress('u1');
      expect(result).toBeDefined();
    });
  });

  // ─── createLevel / updateLevel ─────────────────────────────────────────────

  describe('createLevel', () => {
    it('creates a VIP level with provided data', async () => {
      const prisma = makePrisma();
      prisma.vipLevel.create.mockResolvedValue({ tier: 1 });

      const svc = makeService({ prisma });
      await svc.createLevel({ tier: 1, name: 'Silver', minWagerUsd: '1000', bonusAmount: '50', cashbackRate: '0.02' });

      expect(prisma.vipLevel.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ tier: 1, name: 'Silver' }) }),
      );
    });
  });

  describe('updateLevel', () => {
    it('updates an existing level', async () => {
      const prisma = makePrisma();
      prisma.vipLevel.findUnique.mockResolvedValue({ tier: 1, name: 'Silver' });
      prisma.vipLevel.update.mockResolvedValue({});

      const svc = makeService({ prisma });
      await svc.updateLevel(1, { name: 'Silver Plus' });

      expect(prisma.vipLevel.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ name: 'Silver Plus' }) }),
      );
    });

    it('throws NotFoundException for unknown tier', async () => {
      const prisma = makePrisma();
      prisma.vipLevel.findUnique.mockResolvedValue(null);

      const svc = makeService({ prisma });
      await expect(svc.updateLevel(99, { name: 'X' })).rejects.toThrow(NotFoundException);
    });
  });
});
