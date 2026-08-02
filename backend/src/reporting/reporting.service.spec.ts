import { NotFoundException } from '@nestjs/common';
import { ReportJobStatus, ReportType } from '@prisma/client';
import { ReportingService } from './reporting.service';

function makePrisma(overrides: Record<string, any> = {}) {
  return {
    reportJob: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    user: {
      count: jest.fn().mockResolvedValue(0),
    },
    transaction: {
      groupBy: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    analyticsSnapshot: {
      upsert: jest.fn().mockResolvedValue({}),
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
    ...overrides,
  } as any;
}

function makeService(prisma = makePrisma()) {
  return new ReportingService(prisma);
}

describe('ReportingService', () => {
  // ─── queueReport ──────────────────────────────────────────────────────────

  describe('queueReport', () => {
    it('creates a job and returns it', async () => {
      const prisma = makePrisma();
      const job = { id: 'job-1', reportType: ReportType.REVENUE, status: ReportJobStatus.QUEUED };
      prisma.reportJob.create.mockResolvedValue(job);
      prisma.reportJob.findUnique.mockResolvedValue(job);
      prisma.reportJob.update.mockResolvedValue({});

      const svc = makeService(prisma);
      const result = await svc.queueReport(
        ReportType.REVENUE,
        { from: '2026-01-01', to: '2026-01-31' },
        'admin-1',
      );

      expect(result).toBe(job);
      expect(prisma.reportJob.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ reportType: ReportType.REVENUE, requestedBy: 'admin-1' }),
        }),
      );
    });

    it('triggers background processing via setImmediate', async () => {
      const prisma = makePrisma();
      const job = { id: 'job-bg', reportType: ReportType.PLAYER, status: ReportJobStatus.QUEUED, params: { from: '2026-01-01', to: '2026-01-31' } };
      prisma.reportJob.create.mockResolvedValue(job);
      prisma.reportJob.findUnique.mockResolvedValue(job);
      prisma.reportJob.update.mockResolvedValue({});

      const svc = makeService(prisma);
      jest.spyOn(svc, 'processJob').mockResolvedValue();

      await svc.queueReport(ReportType.PLAYER, { from: '2026-01-01', to: '2026-01-31' }, 'admin');
      await new Promise((r) => setImmediate(r));

      expect(svc.processJob).toHaveBeenCalledWith('job-bg');
    });
  });

  // ─── processJob ───────────────────────────────────────────────────────────

  describe('processJob', () => {
    it('marks job RUNNING then COMPLETED', async () => {
      const prisma = makePrisma();
      const job = {
        id: 'job-2',
        reportType: ReportType.REVENUE,
        status: ReportJobStatus.QUEUED,
        params: { from: '2026-01-01', to: '2026-01-31' },
      };
      prisma.reportJob.findUnique.mockResolvedValue(job);
      prisma.reportJob.update.mockResolvedValue({});

      const svc = makeService(prisma);
      jest.spyOn(svc, 'getRevenueReport').mockResolvedValue([]);

      await svc.processJob('job-2');

      const updateCalls = prisma.reportJob.update.mock.calls;
      expect(updateCalls[0][0].data.status).toBe(ReportJobStatus.RUNNING);
      expect(updateCalls[1][0].data.status).toBe(ReportJobStatus.COMPLETED);
    });

    it('marks job FAILED when report throws', async () => {
      const prisma = makePrisma();
      const job = {
        id: 'job-fail',
        reportType: ReportType.REVENUE,
        status: ReportJobStatus.QUEUED,
        params: { from: '2026-01-01', to: '2026-01-31' },
      };
      prisma.reportJob.findUnique.mockResolvedValue(job);
      prisma.reportJob.update.mockResolvedValue({});

      const svc = makeService(prisma);
      jest.spyOn(svc, 'getRevenueReport').mockRejectedValue(new Error('DB error'));

      await expect(svc.processJob('job-fail')).rejects.toThrow('DB error');

      const updateCalls = prisma.reportJob.update.mock.calls;
      const failUpdate = updateCalls.find((c: any) => c[0].data.status === ReportJobStatus.FAILED);
      expect(failUpdate).toBeDefined();
      expect(failUpdate[0].data.errorMsg).toBe('DB error');
    });

    it('throws NotFoundException for unknown job', async () => {
      const prisma = makePrisma();
      prisma.reportJob.findUnique.mockResolvedValue(null);

      const svc = makeService(prisma);
      await expect(svc.processJob('missing')).rejects.toThrow(NotFoundException);
    });

    it('processes PLAYER report type', async () => {
      const prisma = makePrisma();
      const job = {
        id: 'job-player',
        reportType: ReportType.PLAYER,
        status: ReportJobStatus.QUEUED,
        params: { from: '2026-01-01', to: '2026-01-31' },
      };
      prisma.reportJob.findUnique.mockResolvedValue(job);
      prisma.reportJob.update.mockResolvedValue({});

      const svc = makeService(prisma);
      jest.spyOn(svc, 'getPlayerReport').mockResolvedValue({
        totalPlayers: 100, activePlayers: 50, newPlayers: 10, avgLifetimeValue: '500.00', churnRiskCount: 5,
      });

      await svc.processJob('job-player');

      expect(svc.getPlayerReport).toHaveBeenCalled();
    });

    it('processes GAME report type', async () => {
      const prisma = makePrisma();
      const job = {
        id: 'job-game',
        reportType: ReportType.GAME,
        status: ReportJobStatus.QUEUED,
        params: { from: '2026-01-01', to: '2026-01-31' },
      };
      prisma.reportJob.findUnique.mockResolvedValue(job);
      prisma.reportJob.update.mockResolvedValue({});

      const svc = makeService(prisma);
      jest.spyOn(svc, 'getGameReport').mockResolvedValue([]);

      await svc.processJob('job-game');

      expect(svc.getGameReport).toHaveBeenCalled();
    });
  });

  // ─── getJob / listJobs ────────────────────────────────────────────────────

  describe('getJob', () => {
    it('returns existing job', async () => {
      const prisma = makePrisma();
      const job = { id: 'job-3' };
      prisma.reportJob.findUnique.mockResolvedValue(job);

      const svc = makeService(prisma);
      expect(await svc.getJob('job-3')).toBe(job);
    });

    it('throws NotFoundException for missing job', async () => {
      const prisma = makePrisma();
      prisma.reportJob.findUnique.mockResolvedValue(null);

      const svc = makeService(prisma);
      await expect(svc.getJob('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('listJobs', () => {
    it('returns jobs for requester', async () => {
      const prisma = makePrisma();
      const jobs = [{ id: 'j1' }, { id: 'j2' }];
      prisma.reportJob.findMany.mockResolvedValue(jobs);

      const svc = makeService(prisma);
      expect(await svc.listJobs('admin-1')).toBe(jobs);
      expect(prisma.reportJob.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { requestedBy: 'admin-1' } }),
      );
    });
  });

  // ─── toCsv ────────────────────────────────────────────────────────────────

  describe('toCsv', () => {
    it('returns empty string for empty array', () => {
      const svc = makeService();
      expect(svc.toCsv([])).toBe('');
    });

    it('produces header row and data rows', () => {
      const svc = makeService();
      const csv = svc.toCsv([{ a: '1', b: '2' }, { a: '3', b: '4' }]);
      expect(csv).toBe('a,b\n1,2\n3,4');
    });

    it('quotes values containing commas', () => {
      const svc = makeService();
      const csv = svc.toCsv([{ name: 'A,B', value: '10' }]);
      expect(csv).toContain('"A,B"');
    });
  });
});
