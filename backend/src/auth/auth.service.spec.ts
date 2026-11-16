import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';

jest.mock('bcrypt', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

const bcryptCompare = bcrypt.compare as unknown as jest.Mock;
const bcryptHash = bcrypt.hash as unknown as jest.Mock;

function makeUser(id: string, email: string, passwordHash: string) {
  const now = new Date('2026-01-01T00:00:00.000Z');
  return {
    id,
    email,
    username: `${id}-player`,
    role: 'PLAYER',
    isActive: true,
    kycVerified: false,
    emailVerifiedAt: now,
    createdAt: now,
    updatedAt: now,
    passwordHash,
  };
}

describe('AuthService account persistence and login', () => {
  let service: AuthService;
  let prisma: any;
  let jwt: any;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = {
      user: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
      session: {
        create: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn(),
    };
    jwt = {
      sign: jest.fn().mockReturnValue('test-token'),
    };
    service = new AuthService(prisma as PrismaService, jwt as JwtService);
  });

  it('persists a new account, wallet, and login session in one transaction', async () => {
    const user = makeUser('user-1', 'new.player@example.com', 'hashed-password');
    const tx = {
      user: { create: jest.fn().mockResolvedValue(user) },
      wallet: { create: jest.fn().mockResolvedValue({ id: 'wallet-1' }) },
      session: { create: jest.fn().mockResolvedValue({ id: 'session-1' }) },
    };

    prisma.user.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    prisma.$transaction.mockImplementation(async (callback: (client: any) => unknown) => callback(tx));
    bcryptHash.mockResolvedValue('hashed-password');

    const result = await service.register({
      email: ' New.Player@Example.com ',
      username: 'NewPlayer',
      password: 'safe-password-123',
    } as RegisterDto);

    expect(tx.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        email: 'new.player@example.com',
        username: 'newplayer',
        passwordHash: 'hashed-password',
        isActive: true,
      }),
    }));
    expect(tx.wallet.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 'user-1' }),
    }));
    expect(tx.session.create).toHaveBeenCalledTimes(1);
    expect(result.user.id).toBe('user-1');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('checks all case-insensitive email records and authenticates the one with the matching password', async () => {
    // The newest lowercase record comes first, but the password belongs to an
    // older record created before email normalization was introduced.
    const newest = makeUser('newest-user', 'player@example.com', 'new-hash');
    const legacy = makeUser('legacy-user', 'Player@Example.com', 'legacy-hash');
    prisma.user.findMany.mockResolvedValue([newest, legacy]);
    bcryptCompare
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const result = await service.login({
      email: 'Player@Example.com',
      password: 'the-correct-password',
    } as LoginDto);

    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { email: { equals: 'player@example.com', mode: 'insensitive' } },
      orderBy: { createdAt: 'desc' },
    }));
    expect(bcryptCompare).toHaveBeenCalledTimes(2);
    expect(result.user.id).toBe('legacy-user');
    expect(result).toHaveProperty('accessToken');
    expect(result).toHaveProperty('refreshToken');
    expect(prisma.session.create).toHaveBeenCalledTimes(1);
  });

  it('does not authenticate when none of the saved account passwords match', async () => {
    prisma.user.findMany.mockResolvedValue([
      makeUser('user-1', 'player@example.com', 'saved-hash'),
    ]);
    bcryptCompare.mockResolvedValue(false);

    await expect(service.login({
      email: 'player@example.com',
      password: 'wrong-password',
    } as LoginDto)).rejects.toThrow('Invalid email or password');

    expect(prisma.session.create).not.toHaveBeenCalled();
  });
});
