import { GameSessionStatus, TransactionStatus, TransactionType } from '@prisma/client';
import Decimal from 'decimal.js';
import { AnalyticsService } from './analytics.service';

function makePrisma(overrides: Record<string, any> = {}) {
  return {
    user: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    transaction: {
      groupBy: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    gameSession: {
      count: jest.fn().mockResolvedValue(0),
    },
    analyticsSnapshot: {
      upsert: jest.fn().mockResolvedValue({}),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    ...overrides,
  } as any;
}

function makeService(prisma = makePrisma()) {
  return new AnalyticsService(prisma);
}

describe('AnalyticsService', () => {
  // ─── takeSnapshot ──────────────────────────────────────────────────────────

  describe('takeSnapshot', () => {
    it('queries counts and upserts snapshot', async () => {
      const prisma = makePrisma();
      prisma.user.count
        .mockResolvedValueOnce(500)  // totalPlayers
        .mockResolvedValueOnce(10)   // newPlayers
        .mockResolvedValueOnce(50);  // activePlayers
      prisma.transaction.groupBy.mockResolvedValue([
        { type: TransactionType.DEPOSIT, _sum: { amount: new Decimal('1000') } },
        { type: TransactionType.WITHDRAWAL, _sum: { amount: new Decimal('400') } },
        { type: TransactionType.BET, _sum: { amount: new Decimal('800') } },
        { type: TransactionType.WIN, _sum: { amount: new Decimal('600') } },
      ]);
      prisma.transaction.count.mockResolvedValue(120);

      const svc = makeService(prisma);
      await svc.takeSnapshot(new Date('2026-06-01'));

      expect(prisma.analyticsSnapshot.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            totalPlayers: 500,
            activePlayers: 50,
            newPlayers: 10,
            ggr: '200.00',        // 800 - 600
            totalDeposits: '1000.00',
            totalWithdrawals: '400.00',
            totalBets: 120,
          }),
        }),
      );
    });

    it('computes GGR = bets - wins', async () => {
      const prisma = makePrisma();
      prisma.transaction.groupBy.mockResolvedValue([
        { type: TransactionType.BET, _sum: { amount: new Decimal('300') } },
        { type: TransactionType.WIN, _sum: { amount: new Decimal('250') } },
      ]);

      const svc = makeService(prisma);
      await svc.takeSnapshot(new Date('2026-06-01'));

      const upsert = prisma.analyticsSnapshot.upsert.mock.calls[0][0];
      expect(upsert.create.ggr).toBe('50.00'); // 300 - 250
    });

    it('handles zero transactions gracefully', async () => {
      const svc = makeService();
      await expect(svc.takeSnapshot(new Date('2026-06-01'))).resolves.not.toThrow();

      // ggr should be '0.00' when no transactions
    });

    it('upserts on existing snapshot date (idempotent)', async () => {
      const prisma = makePrisma();
      const svc = makeService(prisma);
      await svc.takeSnapshot(new Date('2026-06-01'));
      await svc.takeSnapshot(new Date('2026-06-01'));

      expect(prisma.analyticsSnapshot.upsert).toHaveBeenCalledTimes(2);
    });
  });

  // ─── getDashboardStats ─────────────────────────────────────────────────────

  describe('getDashboardStats', () => {
    it('returns null snapshot and 0 sessions when no data', async () => {
      const svc = makeService();
      const result = await svc.getDashboardStats();
      expect(result.snapshot).toBeNull();
      expect(result.activeSessions).toBe(0);
    });

    it('returns latest snapshot with formatted date', async () => {
      const prisma = makePrisma();
      prisma.analyticsSnapshot.findFirst.mockResolvedValue({
        snapshotDate: new Date('2026-06-01'),
        totalPlayers: 1000,
        activePlayers: 200,
        newPlayers: 30,
        ggr: new Decimal('5000'),
        totalDeposits: new Decimal('20000'),
        totalWithdrawals: new Decimal('8000'),
        totalBets: 500,
      });
      prisma.gameSession.count.mockResolvedValue(12);

      const svc = makeService(prisma);
      const result = await svc.getDashboardStats();

      expect(result.snapshot?.snapshotDate).toBe('2026-06-01');
      expect(result.snapshot?.totalPlayers).toBe(1000);
      expect(result.activeSessions).toBe(12);
    });

    it('counts only ACTIVE game sessions', async () => {
      const prisma = makePrisma();
      prisma.gameSession.count.mockResolvedValue(7);

      const svc = makeService(prisma);
      await svc.getDashboardStats();

      expect(prisma.gameSession.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: GameSessionStatus.ACTIVE } }),
      );
    });
  });

  // ─── getSegments ──────────────────────────────────────────────────────────

  describe('getSegments', () => {
    it('returns three segments', async () => {
      const prisma = makePrisma();
      prisma.user.findMany
        .mockResolvedValueOnce([{ id: 'hr1' }])    // high rollers
        .mockResolvedValueOnce([{ id: 'd1' }])     // dormant
        .mockResolvedValueOnce([{ id: 'n1' }, { id: 'n2' }]); // new

      const svc = makeService(prisma);
      const segments = await svc.getSegments();

      expect(segments).toHaveLength(3);
      const highRoller = segments.find((s) => s.segment === 'high_roller')!;
      expect(highRoller.count).toBe(1);
      expect(highRoller.userIds).toEqual(['hr1']);

      const dormant = segments.find((s) => s.segment === 'dormant')!;
      expect(dormant.count).toBe(1);

      const newSeg = segments.find((s) => s.segment === 'new')!;
      expect(newSeg.count).toBe(2);
    });

    it('returns empty segments when no matching users', async () => {
      const svc = makeService();
      const segments = await svc.getSegments();
      expect(segments.every((s) => s.count === 0)).toBe(true);
    });
  });

  // ─── getSnapshotHistory ────────────────────────────────────────────────────

  describe('getSnapshotHistory', () => {
    it('returns up to requested days of snapshots', async () => {
      const prisma = makePrisma();
      const snaps = Array.from({ length: 7 }, (_, i) => ({ id: `s${i}` }));
      prisma.analyticsSnapshot.findMany.mockResolvedValue(snaps);

      const svc = makeService(prisma);
      const result = await svc.getSnapshotHistory(7);

      expect(result).toBe(snaps);
      expect(prisma.analyticsSnapshot.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 7, orderBy: { snapshotDate: 'desc' } }),
      );
    });

    it('defaults to 30 days', async () => {
      const prisma = makePrisma();
      prisma.analyticsSnapshot.findMany.mockResolvedValue([]);

      const svc = makeService(prisma);
      await svc.getSnapshotHistory();

      expect(prisma.analyticsSnapshot.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 30 }),
      );
    });
  });

  // ─── scheduledSnapshot (cron handler) ─────────────────────────────────────

  describe('scheduledSnapshot', () => {
    it('calls takeSnapshot without throwing', async () => {
      const svc = makeService();
      jest.spyOn(svc, 'takeSnapshot').mockResolvedValue();

      await expect(svc.scheduledSnapshot()).resolves.not.toThrow();
      expect(svc.takeSnapshot).toHaveBeenCalled();
    });

    it('swallows takeSnapshot errors', async () => {
      const svc = makeService();
      jest.spyOn(svc, 'takeSnapshot').mockRejectedValue(new Error('DB error'));

      await expect(svc.scheduledSnapshot()).resolves.not.toThrow();
    });
  });
});
