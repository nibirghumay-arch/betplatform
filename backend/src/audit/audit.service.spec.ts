import { AuditService } from './audit.service';

function makePrisma(overrides: Record<string, any> = {}) {
  return {
    auditLog: {
      create: jest.fn().mockResolvedValue(undefined),
      findMany: jest.fn().mockResolvedValue([]),
      ...overrides.auditLog,
    },
    ...overrides,
  } as any;
}

function makeService(prisma = makePrisma()) {
  return new AuditService(prisma);
}

const SAMPLE_LOG = {
  id: 'log-1',
  userId: 'user-1',
  action: 'LOGIN',
  resource: 'auth',
  resourceId: null,
  before: null,
  after: null,
  ipAddress: '127.0.0.1',
  userAgent: 'jest',
  createdAt: new Date('2026-06-01T10:00:00Z'),
};

describe('AuditService', () => {
  // ─── log ──────────────────────────────────────────────────────────────────

  describe('log', () => {
    it('creates an audit log entry with all params', async () => {
      const prisma = makePrisma();
      const svc = makeService(prisma);

      await svc.log({
        userId: 'user-1',
        action: 'LOGIN',
        resource: 'auth',
        resourceId: 'session-1',
        before: { foo: 1 },
        after: { bar: 2 },
        ipAddress: '10.0.0.1',
        userAgent: 'Mozilla/5.0',
      });

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          action: 'LOGIN',
          resource: 'auth',
          resourceId: 'session-1',
          ipAddress: '10.0.0.1',
          userAgent: 'Mozilla/5.0',
        }),
      });
    });

    it('creates entry with optional fields omitted', async () => {
      const prisma = makePrisma();
      const svc = makeService(prisma);

      await svc.log({ action: 'REGISTER', resource: 'user' });

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'REGISTER', resource: 'user' }),
      });
    });
  });

  // ─── findAll ──────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('returns all logs with default pagination when no filters', async () => {
      const prisma = makePrisma();
      prisma.auditLog.findMany.mockResolvedValue([SAMPLE_LOG]);
      const svc = makeService(prisma);

      const result = await svc.findAll();

      expect(result).toEqual([SAMPLE_LOG]);
      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {},
          orderBy: { createdAt: 'desc' },
          skip: 0,
          take: 25,
        }),
      );
    });

    it('filters by action', async () => {
      const prisma = makePrisma();
      prisma.auditLog.findMany.mockResolvedValue([SAMPLE_LOG]);
      const svc = makeService(prisma);

      await svc.findAll({ action: 'LOGIN' });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { action: 'LOGIN' } }),
      );
    });

    it('filters by date range', async () => {
      const prisma = makePrisma();
      const svc = makeService(prisma);

      await svc.findAll({ from: '2026-06-01', to: '2026-06-07' });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            createdAt: {
              gte: new Date('2026-06-01'),
              lte: new Date('2026-06-07'),
            },
          },
        }),
      );
    });

    it('applies skip and take for pagination', async () => {
      const prisma = makePrisma();
      const svc = makeService(prisma);

      await svc.findAll({ skip: 25, take: 10 });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 25, take: 10 }),
      );
    });

    it('combines action filter with date range', async () => {
      const prisma = makePrisma();
      const svc = makeService(prisma);

      await svc.findAll({ action: 'DEPOSIT', from: '2026-06-01' });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            action: 'DEPOSIT',
            createdAt: { gte: new Date('2026-06-01') },
          },
        }),
      );
    });
  });

  // ─── findByUser ───────────────────────────────────────────────────────────

  describe('findByUser', () => {
    it('queries by userId with default pagination', async () => {
      const prisma = makePrisma();
      prisma.auditLog.findMany.mockResolvedValue([SAMPLE_LOG]);
      const svc = makeService(prisma);

      const result = await svc.findByUser('user-1');

      expect(result).toEqual([SAMPLE_LOG]);
      expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: { createdAt: 'desc' },
        take: 50,
        skip: 0,
      });
    });

    it('respects custom take and skip', async () => {
      const prisma = makePrisma();
      const svc = makeService(prisma);

      await svc.findByUser('user-2', 10, 20);

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-2' },
        orderBy: { createdAt: 'desc' },
        take: 10,
        skip: 20,
      });
    });
  });

  // ─── findByResource ───────────────────────────────────────────────────────

  describe('findByResource', () => {
    it('queries by resource and resourceId', async () => {
      const prisma = makePrisma();
      prisma.auditLog.findMany.mockResolvedValue([SAMPLE_LOG]);
      const svc = makeService(prisma);

      const result = await svc.findByResource('wallet', 'wallet-1');

      expect(result).toEqual([SAMPLE_LOG]);
      expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
        where: { resource: 'wallet', resourceId: 'wallet-1' },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('returns empty array when no entries match', async () => {
      const svc = makeService();
      const result = await svc.findByResource('unknown', 'id-1');
      expect(result).toEqual([]);
    });
  });
});
