import { AdminUsersService } from './users.service';

const USER_SELECT = {
  id: true,
  email: true,
  username: true,
  role: true,
  isActive: true,
  kycVerified: true,
  createdAt: true,
  updatedAt: true,
};

function makePrisma(overrides: Record<string, any> = {}) {
  return {
    user: {
      findMany: jest.fn().mockResolvedValue([]),
      ...overrides.user,
    },
    ...overrides,
  } as any;
}

function makeService(prisma = makePrisma()) {
  return new AdminUsersService(prisma);
}

const SAMPLE_USER = {
  id: 'user-1',
  email: 'alice@example.com',
  username: 'alice',
  role: 'PLAYER',
  isActive: true,
  kycVerified: false,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

describe('AdminUsersService', () => {
  describe('findAll', () => {
    it('returns all users with default pagination when no filters', async () => {
      const prisma = makePrisma();
      prisma.user.findMany.mockResolvedValue([SAMPLE_USER]);
      const svc = makeService(prisma);

      const result = await svc.findAll();

      expect(result).toEqual([SAMPLE_USER]);
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {},
          select: USER_SELECT,
          orderBy: { createdAt: 'desc' },
          skip: 0,
          take: 25,
        }),
      );
    });

    it('filters by isActive=true', async () => {
      const prisma = makePrisma();
      const svc = makeService(prisma);

      await svc.findAll({ isActive: true });

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true } }),
      );
    });

    it('filters by isActive=false (suspended users)', async () => {
      const prisma = makePrisma();
      const svc = makeService(prisma);

      await svc.findAll({ isActive: false });

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: false } }),
      );
    });

    it('searches email and username with OR condition', async () => {
      const prisma = makePrisma();
      prisma.user.findMany.mockResolvedValue([SAMPLE_USER]);
      const svc = makeService(prisma);

      await svc.findAll({ search: 'alice' });

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { email: { contains: 'alice', mode: 'insensitive' } },
              { username: { contains: 'alice', mode: 'insensitive' } },
            ],
          },
        }),
      );
    });

    it('combines search with isActive filter', async () => {
      const prisma = makePrisma();
      const svc = makeService(prisma);

      await svc.findAll({ search: 'bob', isActive: false });

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            isActive: false,
            OR: [
              { email: { contains: 'bob', mode: 'insensitive' } },
              { username: { contains: 'bob', mode: 'insensitive' } },
            ],
          },
        }),
      );
    });

    it('applies skip and take for pagination', async () => {
      const prisma = makePrisma();
      const svc = makeService(prisma);

      await svc.findAll({ skip: 50, take: 10 });

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 50, take: 10 }),
      );
    });

    it('returns empty array when no users match', async () => {
      const svc = makeService();
      const result = await svc.findAll({ search: 'nobody' });
      expect(result).toEqual([]);
    });

    it('selects only safe fields (excludes passwordHash)', async () => {
      const prisma = makePrisma();
      const svc = makeService(prisma);

      await svc.findAll();

      const call = prisma.user.findMany.mock.calls[0][0];
      expect(call.select).toBeDefined();
      expect(call.select.passwordHash).toBeUndefined();
      expect(call.select.id).toBe(true);
      expect(call.select.email).toBe(true);
    });
  });
});
