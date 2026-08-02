import {
  Injectable,
  Logger,
  OnModuleInit,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GameSessionStatus } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../../prisma/prisma.service';
import { WalletService } from '../../../wallet/wallet.service';
import { GameEventService } from '../../../games/game-event.service';
import { ProviderRegistry } from '../../provider.registry';
import type {
  ProviderAdapter,
  PlayerAuthResult,
  GameSessionData,
  GameLaunchConfig,
  BalanceSyncResult,
  BetResult,
  WinResult,
  RefundResult,
  GameInfo,
  GameCategoryInfo,
  ProcessBetParams,
  ProcessWinParams,
  RefundRoundParams,
  GameCatalogFilter,
} from '../../interfaces/provider-adapter.interface';

@Injectable()
export class Html5GameAdapter implements ProviderAdapter, OnModuleInit {
  readonly providerId = 'html5';
  readonly displayName = 'HTML5 Games (iframe / postMessage)';

  private readonly logger = new Logger(Html5GameAdapter.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly gameEventService: GameEventService,
    private readonly config: ConfigService,
    private readonly registry: ProviderRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private get sessionTtlMs(): number {
    return (this.config.get<number>('GAME_SESSION_TTL_MINUTES', 120)) * 60_000;
  }

  private get gameBaseUrl(): string {
    return this.config.get<string>('HTML5_GAME_BASE_URL', 'http://localhost:4000');
  }

  private get allowedOrigins(): string[] {
    return this.config
      .get<string>('HTML5_GAME_ALLOWED_ORIGINS', 'http://localhost:3000')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
  }

  /** Fetch an ACTIVE, non-expired session. Marks as EXPIRED and throws if TTL elapsed. */
  private async getActiveSession(sessionId: string) {
    const session = await this.prisma.gameSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        userId: true,
        gameId: true,
        status: true,
        currency: true,
        expiresAt: true,
      },
    });

    if (!session) throw new NotFoundException(`Session ${sessionId} not found`);

    if (session.status !== GameSessionStatus.ACTIVE) {
      throw new BadRequestException(
        `Session ${sessionId} is not active (status: ${session.status})`,
      );
    }

    if (session.expiresAt < new Date()) {
      await this.prisma.gameSession.update({
        where: { id: sessionId },
        data: { status: GameSessionStatus.EXPIRED, endedAt: new Date() },
      });
      throw new BadRequestException(`Session ${sessionId} has expired`);
    }

    return session;
  }

  // ─── ProviderAdapter implementation ────────────────────────────────────────

  /**
   * Verify the player exists in the platform (has a wallet) and issue a
   * short-lived game token. In Phase 1 (full auth) this will also validate
   * the platform JWT; for now it asserts the user is a registered player.
   */
  async authenticatePlayer(userId: string, _token: string): Promise<PlayerAuthResult> {
    await this.walletService.getWalletByUserId(userId);

    const token = uuidv4();
    const expiresAt = new Date(Date.now() + this.sessionTtlMs);

    this.logger.log(`Player authenticated for gaming: userId=${userId}`);
    return { playerId: userId, token, expiresAt };
  }

  /**
   * Create an ACTIVE game session. Must be called before launchGame().
   */
  async createSession(
    userId: string,
    gameId: string,
    currency = 'USD',
  ): Promise<GameSessionData> {
    const game = await this.prisma.gameDefinition.findUnique({
      where: { id: gameId },
      select: { id: true, isActive: true, providerId: true },
    });

    if (!game) throw new NotFoundException(`Game ${gameId} not found`);
    if (!game.isActive) throw new BadRequestException(`Game ${gameId} is not active`);
    if (game.providerId !== this.providerId) {
      throw new BadRequestException(
        `Game ${gameId} belongs to provider '${game.providerId}', not '${this.providerId}'`,
      );
    }

    await this.walletService.getWalletByUserId(userId);

    const token = uuidv4();
    const expiresAt = new Date(Date.now() + this.sessionTtlMs);

    const session = await this.prisma.gameSession.create({
      data: {
        userId,
        gameId,
        providerId: this.providerId,
        token,
        currency,
        status: GameSessionStatus.ACTIVE,
        expiresAt,
      },
      select: {
        id: true,
        token: true,
        gameId: true,
        userId: true,
        currency: true,
        expiresAt: true,
      },
    });

    this.logger.log(`Session created: id=${session.id} userId=${userId} gameId=${gameId}`);
    return {
      sessionId: session.id,
      token: session.token,
      gameId: session.gameId,
      userId: session.userId,
      currency: session.currency,
      expiresAt: session.expiresAt,
    };
  }

  /**
   * Build the iframe launch configuration for an existing ACTIVE session.
   * The iframeUrl contains the session token so the game can authenticate
   * postMessage events without an additional auth round-trip.
   */
  async launchGame(sessionId: string): Promise<GameLaunchConfig> {
    const session = await this.prisma.gameSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        userId: true,
        status: true,
        token: true,
        currency: true,
        expiresAt: true,
        game: { select: { gameUrl: true, slug: true } },
      },
    });

    if (!session) throw new NotFoundException(`Session ${sessionId} not found`);
    if (session.status !== GameSessionStatus.ACTIVE) {
      throw new BadRequestException(
        `Session ${sessionId} is not active (status: ${session.status})`,
      );
    }
    if (session.expiresAt < new Date()) {
      await this.prisma.gameSession.update({
        where: { id: sessionId },
        data: { status: GameSessionStatus.EXPIRED, endedAt: new Date() },
      });
      throw new BadRequestException(`Session ${sessionId} has expired`);
    }

    const rawUrl = session.game.gameUrl;
    const gameUrl = rawUrl.startsWith('http') ? rawUrl : `${this.gameBaseUrl}/${rawUrl}`;
    const iframeUrl = `${gameUrl}?token=${session.token}&currency=${session.currency}`;

    await this.prisma.gameSession.update({
      where: { id: sessionId },
      data: { launchUrl: iframeUrl },
    });

    this.logger.log(`Game launched: sessionId=${sessionId} url=${iframeUrl}`);

    return {
      sessionId,
      iframeUrl,
      token: session.token,
      allowedOrigins: this.allowedOrigins,
      postMessageConfig: {
        namespace: 'html5game',
        events: ['BALANCE', 'BET', 'WIN', 'REFUND', 'CANCEL', 'SESSION_END'],
      },
    };
  }

  /**
   * Return the player's current wallet balance.
   * Called by the iframe on load and after each round to display an updated balance.
   */
  async syncBalance(userId: string): Promise<BalanceSyncResult> {
    const result = await this.walletService.getBalance(userId);
    return {
      userId,
      walletId: result.walletId,
      balance: result.balance,
      currency: result.currency,
    };
  }

  /**
   * Debit the player for a bet. Delegates to GameEventService → TransactionService.
   * Idempotent: a duplicate roundId returns ConflictException which the caller should
   * treat as already-processed (GameEventService handles this internally).
   */
  async processBet(params: ProcessBetParams): Promise<BetResult> {
    const session = await this.getActiveSession(params.sessionId);

    const result = await this.gameEventService.handleEvent({
      eventType: 'BET',
      userId: session.userId,
      gameRoundId: params.roundId,
      amount: params.amount,
      metadata: params.metadata,
    });

    if (!result.success) {
      throw new BadRequestException(result.error ?? 'Bet processing failed');
    }

    return {
      transactionId: result.transactionId!,
      roundId: params.roundId,
      amount: params.amount,
      balanceAfter: result.balance!,
      currency: result.currency!,
      reference: result.reference!,
    };
  }

  /**
   * Credit the player for a win.
   */
  async processWin(params: ProcessWinParams): Promise<WinResult> {
    const session = await this.getActiveSession(params.sessionId);

    const result = await this.gameEventService.handleEvent({
      eventType: 'WIN',
      userId: session.userId,
      gameRoundId: params.roundId,
      amount: params.amount,
      metadata: params.metadata,
    });

    if (!result.success) {
      throw new BadRequestException(result.error ?? 'Win processing failed');
    }

    return {
      transactionId: result.transactionId!,
      roundId: params.roundId,
      amount: params.amount,
      balanceAfter: result.balance!,
      currency: result.currency!,
      reference: result.reference!,
    };
  }

  /**
   * Refund a round (cancelled or voided by the game engine).
   */
  async refundRound(params: RefundRoundParams): Promise<RefundResult> {
    const session = await this.getActiveSession(params.sessionId);

    const result = await this.gameEventService.handleEvent({
      eventType: 'REFUND',
      userId: session.userId,
      gameRoundId: params.roundId,
      amount: params.amount,
    });

    if (!result.success) {
      throw new BadRequestException(result.error ?? 'Refund processing failed');
    }

    return {
      transactionId: result.transactionId!,
      roundId: params.roundId,
      amount: params.amount,
      balanceAfter: result.balance!,
      currency: result.currency!,
      reference: result.reference!,
    };
  }

  /**
   * Return all games belonging to this provider, with optional category filter.
   */
  async getGameCatalog(filter?: GameCatalogFilter): Promise<GameInfo[]> {
    const games = await this.prisma.gameDefinition.findMany({
      where: {
        providerId: this.providerId,
        isActive: filter?.isActive ?? true,
        ...(filter?.categorySlug
          ? { category: { slug: filter.categorySlug } }
          : {}),
      },
      include: { category: { select: { name: true, slug: true } } },
      orderBy: { name: 'asc' },
    });

    return games.map((g) => ({
      id: g.id,
      externalId: g.externalId,
      providerId: g.providerId,
      name: g.name,
      slug: g.slug,
      category: g.category.slug,
      categoryName: g.category.name,
      description: g.description,
      thumbnailUrl: g.thumbnailUrl,
      gameUrl: g.gameUrl,
      rtp: g.rtp?.toString() ?? null,
      isActive: g.isActive,
      metadata: g.metadata as Record<string, unknown> | null,
    }));
  }

  async updateGame(gameId: string, data: { isActive?: boolean }): Promise<GameInfo> {
    const g = await this.prisma.gameDefinition.update({
      where: { id: gameId },
      data,
      include: { category: { select: { name: true, slug: true } } },
    });
    return {
      id: g.id,
      externalId: g.externalId,
      providerId: g.providerId,
      name: g.name,
      slug: g.slug,
      category: g.category.slug,
      categoryName: g.category.name,
      description: g.description,
      thumbnailUrl: g.thumbnailUrl,
      gameUrl: g.gameUrl,
      rtp: g.rtp?.toString() ?? null,
      isActive: g.isActive,
      metadata: g.metadata as Record<string, unknown> | null,
    };
  }

  /**
   * Return all active categories with a count of games from this provider.
   */
  async getGameCategories(): Promise<GameCategoryInfo[]> {
    const categories = await this.prisma.gameCategory.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: {
        _count: {
          select: {
            games: { where: { isActive: true, providerId: this.providerId } },
          },
        },
      },
    });

    return categories.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      description: c.description,
      gameCount: c._count.games,
    }));
  }
}
