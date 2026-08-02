import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GameSessionStatus } from '@prisma/client';
import { Html5GameAdapter } from './html5-game.adapter';
import { PrismaService } from '../../../prisma/prisma.service';
import { WalletService } from '../../../wallet/wallet.service';
import { GameEventService } from '../../../games/game-event.service';
import { ProviderRegistry } from '../../provider.registry';

// ─── Stubs ────────────────────────────────────────────────────────────────────

const GAME_STUB = {
  id: 'game-1',
  isActive: true,
  providerId: 'html5',
  slug: 'demo-slot',
  gameUrl: 'slots/demo',
  name: 'Demo Slot',
  externalId: 'demo-slot-v1',
  categoryId: 'cat-1',
  description: null,
  thumbnailUrl: null,
  rtp: null,
  metadata: null,
  category: { name: 'Slots', slug: 'slots' },
};

const SESSION_STUB = {
  id: 'session-1',
  userId: 'user-1',
  gameId: 'game-1',
  status: GameSessionStatus.ACTIVE,
  token: 'tok-abc',
  currency: 'USD',
  expiresAt: new Date(Date.now() + 7_200_000),
  game: { gameUrl: 'slots/demo', slug: 'demo-slot' },
};

const WALLET_STUB = { id: 'wallet-1', userId: 'user-1', currency: 'USD' };

const GAME_EVENT_SUCCESS = {
  success: true,
  transactionId: 'tx-1',
  balance: '90.00',
  currency: 'USD',
  reference: 'bet:round-1',
};

// ─── Mock factories ───────────────────────────────────────────────────────────

function buildPrismaMock() {
  return {
    gameDefinition: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    gameSession: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    gameCategory: {
      findMany: jest.fn(),
    },
  } as unknown as PrismaService;
}

function buildWalletMock() {
  return {
    getWalletByUserId: jest.fn().mockResolvedValue(WALLET_STUB),
    getBalance: jest.fn().mockResolvedValue({ walletId: 'wallet-1', balance: '100.00', currency: 'USD' }),
  } as unknown as WalletService;
}

function buildGameEventMock() {
  return {
    handleEvent: jest.fn().mockResolvedValue(GAME_EVENT_SUCCESS),
  } as unknown as GameEventService;
}

function buildRegistryMock() {
  return { register: jest.fn() } as unknown as ProviderRegistry;
}

function buildConfigMock() {
  return {
    get: jest.fn().mockImplementation((key: string, defaultVal?: unknown) => {
      const cfg: Record<string, unknown> = {
        HTML5_GAME_BASE_URL: 'https://games.test.com',
        HTML5_GAME_ALLOWED_ORIGINS: 'https://platform.test.com,https://staging.test.com',
        GAME_SESSION_TTL_MINUTES: 120,
      };
      return cfg[key] ?? defaultVal;
    }),
  } as unknown as ConfigService;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Html5GameAdapter', () => {
  let adapter: Html5GameAdapter;
  let prisma: ReturnType<typeof buildPrismaMock>;
  let walletService: ReturnType<typeof buildWalletMock>;
  let gameEventService: ReturnType<typeof buildGameEventMock>;
  let registry: ReturnType<typeof buildRegistryMock>;

  beforeEach(async () => {
    prisma = buildPrismaMock();
    walletService = buildWalletMock();
    gameEventService = buildGameEventMock();
    registry = buildRegistryMock();
    const configService = buildConfigMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        Html5GameAdapter,
        { provide: PrismaService, useValue: prisma },
        { provide: WalletService, useValue: walletService },
        { provide: GameEventService, useValue: gameEventService },
        { provide: ConfigService, useValue: configService },
        { provide: ProviderRegistry, useValue: registry },
      ],
    }).compile();

    adapter = module.get(Html5GameAdapter);
    // Trigger OnModuleInit
    adapter.onModuleInit();
  });

  // ─── onModuleInit ──────────────────────────────────────────────────────────

  describe('onModuleInit', () => {
    it('registers itself with the ProviderRegistry', () => {
      expect(registry.register).toHaveBeenCalledWith(adapter);
    });

    it('exposes providerId = "html5"', () => {
      expect(adapter.providerId).toBe('html5');
    });
  });

  // ─── authenticatePlayer ────────────────────────────────────────────────────

  describe('authenticatePlayer', () => {
    it('returns a PlayerAuthResult with playerId and a non-empty token', async () => {
      const result = await adapter.authenticatePlayer('user-1', 'platform-jwt');
      expect(result.playerId).toBe('user-1');
      expect(result.token).toBeTruthy();
      expect(result.expiresAt).toBeInstanceOf(Date);
    });

    it('sets expiresAt ~120 minutes from now', async () => {
      const before = Date.now();
      const result = await adapter.authenticatePlayer('user-1', 'jwt');
      const after = Date.now();
      const ttlMs = result.expiresAt.getTime();
      expect(ttlMs).toBeGreaterThanOrEqual(before + 119 * 60_000);
      expect(ttlMs).toBeLessThanOrEqual(after + 121 * 60_000);
    });

    it('generates a unique token on each call', async () => {
      const r1 = await adapter.authenticatePlayer('user-1', 'jwt');
      const r2 = await adapter.authenticatePlayer('user-1', 'jwt');
      expect(r1.token).not.toBe(r2.token);
    });

    it('propagates NotFoundException when user has no wallet', async () => {
      (walletService.getWalletByUserId as jest.Mock).mockRejectedValue(
        new NotFoundException('no wallet'),
      );
      await expect(adapter.authenticatePlayer('ghost', 'jwt')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // ─── createSession ─────────────────────────────────────────────────────────

  describe('createSession', () => {
    beforeEach(() => {
      (prisma.gameDefinition.findUnique as jest.Mock).mockResolvedValue(GAME_STUB);
      (prisma.gameSession.create as jest.Mock).mockResolvedValue({
        id: 'session-1',
        token: 'tok-xyz',
        gameId: 'game-1',
        userId: 'user-1',
        currency: 'USD',
        expiresAt: new Date(Date.now() + 7_200_000),
      });
    });

    it('returns a GameSessionData with sessionId and token', async () => {
      const result = await adapter.createSession('user-1', 'game-1');
      expect(result.sessionId).toBe('session-1');
      expect(result.token).toBe('tok-xyz');
      expect(result.gameId).toBe('game-1');
      expect(result.userId).toBe('user-1');
    });

    it('persists the session to the database', async () => {
      await adapter.createSession('user-1', 'game-1');
      expect(prisma.gameSession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            gameId: 'game-1',
            providerId: 'html5',
            status: GameSessionStatus.ACTIVE,
          }),
        }),
      );
    });

    it('throws NotFoundException when game does not exist', async () => {
      (prisma.gameDefinition.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(adapter.createSession('user-1', 'bad-game')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws BadRequestException when game is inactive', async () => {
      (prisma.gameDefinition.findUnique as jest.Mock).mockResolvedValue({
        ...GAME_STUB,
        isActive: false,
      });
      await expect(adapter.createSession('user-1', 'game-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('throws BadRequestException when game belongs to a different provider', async () => {
      (prisma.gameDefinition.findUnique as jest.Mock).mockResolvedValue({
        ...GAME_STUB,
        providerId: 'pragmatic',
      });
      await expect(adapter.createSession('user-1', 'game-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('uses the supplied currency', async () => {
      await adapter.createSession('user-1', 'game-1', 'EUR');
      expect(prisma.gameSession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ currency: 'EUR' }),
        }),
      );
    });
  });

  // ─── launchGame ────────────────────────────────────────────────────────────

  describe('launchGame', () => {
    beforeEach(() => {
      (prisma.gameSession.findUnique as jest.Mock).mockResolvedValue(SESSION_STUB);
      (prisma.gameSession.update as jest.Mock).mockResolvedValue({});
    });

    it('returns a GameLaunchConfig with an iframeUrl containing the session token', async () => {
      const result = await adapter.launchGame('session-1');
      expect(result.iframeUrl).toContain('token=tok-abc');
      expect(result.token).toBe('tok-abc');
      expect(result.sessionId).toBe('session-1');
    });

    it('builds the iframe URL using the configured base URL for relative game paths', async () => {
      const result = await adapter.launchGame('session-1');
      expect(result.iframeUrl).toContain('https://games.test.com/slots/demo');
    });

    it('uses an absolute game URL as-is when it starts with http', async () => {
      (prisma.gameSession.findUnique as jest.Mock).mockResolvedValue({
        ...SESSION_STUB,
        game: { gameUrl: 'https://cdn.example.com/games/slot', slug: 'slot' },
      });
      const result = await adapter.launchGame('session-1');
      expect(result.iframeUrl).toContain('https://cdn.example.com/games/slot');
      expect(result.iframeUrl).not.toContain('games.test.com');
    });

    it('returns parsed allowedOrigins from config', async () => {
      const result = await adapter.launchGame('session-1');
      expect(result.allowedOrigins).toEqual([
        'https://platform.test.com',
        'https://staging.test.com',
      ]);
    });

    it('includes the expected postMessage event list', async () => {
      const result = await adapter.launchGame('session-1');
      expect(result.postMessageConfig.events).toContain('BET');
      expect(result.postMessageConfig.events).toContain('WIN');
      expect(result.postMessageConfig.events).toContain('REFUND');
      expect(result.postMessageConfig.namespace).toBe('html5game');
    });

    it('saves the launch URL to the session record', async () => {
      await adapter.launchGame('session-1');
      expect(prisma.gameSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'session-1' },
          data: expect.objectContaining({ launchUrl: expect.stringContaining('token=tok-abc') }),
        }),
      );
    });

    it('throws NotFoundException when the session does not exist', async () => {
      (prisma.gameSession.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(adapter.launchGame('bad-session')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws BadRequestException for a non-ACTIVE session', async () => {
      (prisma.gameSession.findUnique as jest.Mock).mockResolvedValue({
        ...SESSION_STUB,
        status: GameSessionStatus.COMPLETED,
      });
      await expect(adapter.launchGame('session-1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('marks the session EXPIRED and throws when the TTL has elapsed', async () => {
      (prisma.gameSession.findUnique as jest.Mock).mockResolvedValue({
        ...SESSION_STUB,
        expiresAt: new Date(Date.now() - 1_000), // 1 second in the past
      });
      await expect(adapter.launchGame('session-1')).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.gameSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: GameSessionStatus.EXPIRED }),
        }),
      );
    });
  });

  // ─── syncBalance ───────────────────────────────────────────────────────────

  describe('syncBalance', () => {
    it('delegates to WalletService and returns a BalanceSyncResult', async () => {
      const result = await adapter.syncBalance('user-1');
      expect(walletService.getBalance).toHaveBeenCalledWith('user-1');
      expect(result.balance).toBe('100.00');
      expect(result.currency).toBe('USD');
      expect(result.walletId).toBe('wallet-1');
      expect(result.userId).toBe('user-1');
    });
  });

  // ─── processBet ────────────────────────────────────────────────────────────

  describe('processBet', () => {
    beforeEach(() => {
      (prisma.gameSession.findUnique as jest.Mock).mockResolvedValue(SESSION_STUB);
    });

    it('calls GameEventService with a BET event and the session userId', async () => {
      await adapter.processBet({ sessionId: 'session-1', roundId: 'round-1', amount: '10.00' });
      expect(gameEventService.handleEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'BET',
          userId: 'user-1',
          gameRoundId: 'round-1',
          amount: '10.00',
        }),
      );
    });

    it('maps the GameEventResult to a BetResult', async () => {
      const result = await adapter.processBet({
        sessionId: 'session-1',
        roundId: 'round-1',
        amount: '10.00',
      });
      expect(result.transactionId).toBe('tx-1');
      expect(result.roundId).toBe('round-1');
      expect(result.balanceAfter).toBe('90.00');
      expect(result.reference).toBe('bet:round-1');
    });

    it('passes optional metadata to the game event', async () => {
      await adapter.processBet({
        sessionId: 'session-1',
        roundId: 'round-1',
        amount: '5.00',
        metadata: { lines: 20 },
      });
      expect(gameEventService.handleEvent).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: { lines: 20 } }),
      );
    });

    it('throws BadRequestException when GameEventService reports failure', async () => {
      (gameEventService.handleEvent as jest.Mock).mockResolvedValue({
        success: false,
        error: 'Insufficient funds: balance 5.00, required 10.00',
      });
      await expect(
        adapter.processBet({ sessionId: 'session-1', roundId: 'round-1', amount: '10.00' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequestException when the session has expired', async () => {
      (prisma.gameSession.findUnique as jest.Mock).mockResolvedValue({
        ...SESSION_STUB,
        expiresAt: new Date(Date.now() - 1_000),
      });
      (prisma.gameSession.update as jest.Mock).mockResolvedValue({});
      await expect(
        adapter.processBet({ sessionId: 'session-1', roundId: 'round-1', amount: '10.00' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // ─── processWin ────────────────────────────────────────────────────────────

  describe('processWin', () => {
    beforeEach(() => {
      (prisma.gameSession.findUnique as jest.Mock).mockResolvedValue(SESSION_STUB);
      (gameEventService.handleEvent as jest.Mock).mockResolvedValue({
        ...GAME_EVENT_SUCCESS,
        reference: 'win:round-1',
        balance: '150.00',
      });
    });

    it('calls GameEventService with a WIN event', async () => {
      await adapter.processWin({ sessionId: 'session-1', roundId: 'round-1', amount: '50.00' });
      expect(gameEventService.handleEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'WIN', userId: 'user-1', gameRoundId: 'round-1' }),
      );
    });

    it('maps the result to WinResult', async () => {
      const result = await adapter.processWin({
        sessionId: 'session-1',
        roundId: 'round-1',
        amount: '50.00',
      });
      expect(result.balanceAfter).toBe('150.00');
      expect(result.reference).toBe('win:round-1');
    });

    it('throws BadRequestException on GameEventService failure', async () => {
      (gameEventService.handleEvent as jest.Mock).mockResolvedValue({
        success: false,
        error: 'Win processing failed',
      });
      await expect(
        adapter.processWin({ sessionId: 'session-1', roundId: 'round-1', amount: '50.00' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // ─── refundRound ───────────────────────────────────────────────────────────

  describe('refundRound', () => {
    beforeEach(() => {
      (prisma.gameSession.findUnique as jest.Mock).mockResolvedValue(SESSION_STUB);
      (gameEventService.handleEvent as jest.Mock).mockResolvedValue({
        ...GAME_EVENT_SUCCESS,
        reference: 'refund:round-1',
        balance: '100.00',
      });
    });

    it('calls GameEventService with a REFUND event', async () => {
      await adapter.refundRound({ sessionId: 'session-1', roundId: 'round-1', amount: '10.00' });
      expect(gameEventService.handleEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'REFUND', userId: 'user-1', gameRoundId: 'round-1' }),
      );
    });

    it('maps the result to RefundResult', async () => {
      const result = await adapter.refundRound({
        sessionId: 'session-1',
        roundId: 'round-1',
        amount: '10.00',
      });
      expect(result.roundId).toBe('round-1');
      expect(result.reference).toBe('refund:round-1');
    });
  });

  // ─── getGameCatalog ────────────────────────────────────────────────────────

  describe('getGameCatalog', () => {
    beforeEach(() => {
      (prisma.gameDefinition.findMany as jest.Mock).mockResolvedValue([GAME_STUB]);
    });

    it('returns a mapped list of GameInfo', async () => {
      const result = await adapter.getGameCatalog();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Demo Slot');
      expect(result[0].providerId).toBe('html5');
      expect(result[0].category).toBe('slots');
      expect(result[0].categoryName).toBe('Slots');
    });

    it('filters by this adapter\'s providerId', async () => {
      await adapter.getGameCatalog();
      expect(prisma.gameDefinition.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ providerId: 'html5' }),
        }),
      );
    });

    it('applies categorySlug filter when provided', async () => {
      await adapter.getGameCatalog({ categorySlug: 'slots' });
      expect(prisma.gameDefinition.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ category: { slug: 'slots' } }),
        }),
      );
    });

    it('defaults isActive to true when filter is omitted', async () => {
      await adapter.getGameCatalog();
      expect(prisma.gameDefinition.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isActive: true }),
        }),
      );
    });

    it('respects explicit isActive: false filter', async () => {
      (prisma.gameDefinition.findMany as jest.Mock).mockResolvedValue([]);
      await adapter.getGameCatalog({ isActive: false });
      expect(prisma.gameDefinition.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isActive: false }),
        }),
      );
    });

    it('returns an empty array when no games match', async () => {
      (prisma.gameDefinition.findMany as jest.Mock).mockResolvedValue([]);
      expect(await adapter.getGameCatalog()).toEqual([]);
    });
  });

  // ─── getGameCategories ─────────────────────────────────────────────────────

  describe('getGameCategories', () => {
    beforeEach(() => {
      (prisma.gameCategory.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'cat-1',
          name: 'Slots',
          slug: 'slots',
          description: 'Slot games',
          _count: { games: 7 },
        },
        {
          id: 'cat-2',
          name: 'Table Games',
          slug: 'table',
          description: null,
          _count: { games: 3 },
        },
      ]);
    });

    it('returns a GameCategoryInfo array with correct game counts', async () => {
      const result = await adapter.getGameCategories();
      expect(result).toHaveLength(2);
      expect(result[0].slug).toBe('slots');
      expect(result[0].gameCount).toBe(7);
      expect(result[1].gameCount).toBe(3);
    });

    it('queries only active categories ordered by sortOrder', async () => {
      await adapter.getGameCategories();
      expect(prisma.gameCategory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
        }),
      );
    });

    it('scopes the game count to this provider\'s games', async () => {
      await adapter.getGameCategories();
      expect(prisma.gameCategory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            _count: expect.objectContaining({
              select: expect.objectContaining({
                games: expect.objectContaining({
                  where: expect.objectContaining({ providerId: 'html5' }),
                }),
              }),
            }),
          }),
        }),
      );
    });

    it('returns an empty array when no categories exist', async () => {
      (prisma.gameCategory.findMany as jest.Mock).mockResolvedValue([]);
      expect(await adapter.getGameCategories()).toEqual([]);
    });
  });
});
