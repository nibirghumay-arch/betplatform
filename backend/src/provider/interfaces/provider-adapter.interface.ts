// ─── Shared value types ───────────────────────────────────────────────────────

export interface PlayerAuthResult {
  playerId: string;
  /** Short-lived game token — opaque to the client, used in postMessage events. */
  token: string;
  expiresAt: Date;
}

export interface GameSessionData {
  sessionId: string;
  token: string;
  gameId: string;
  userId: string;
  currency: string;
  expiresAt: Date;
}

export interface GameLaunchConfig {
  sessionId: string;
  /** Full URL for the <iframe src>. Contains the session token as a query param. */
  iframeUrl: string;
  token: string;
  /** Origins that are permitted to send postMessage events to this session. */
  allowedOrigins: string[];
  postMessageConfig: {
    /** All postMessage payloads must include this namespace to be processed. */
    namespace: string;
    /** Event names the platform expects to receive from the iframe. */
    events: string[];
  };
}

export interface BalanceSyncResult {
  userId: string;
  walletId: string;
  balance: string;
  currency: string;
}

export interface BetResult {
  transactionId: string;
  roundId: string;
  amount: string;
  balanceAfter: string;
  currency: string;
  reference: string;
}

export interface WinResult {
  transactionId: string;
  roundId: string;
  amount: string;
  balanceAfter: string;
  currency: string;
  reference: string;
}

export interface RefundResult {
  transactionId: string;
  roundId: string;
  amount: string;
  balanceAfter: string;
  currency: string;
  reference: string;
}

export interface GameInfo {
  id: string;
  externalId: string;
  providerId: string;
  name: string;
  slug: string;
  category: string;
  categoryName: string;
  description: string | null;
  thumbnailUrl: string | null;
  gameUrl: string;
  rtp: string | null;
  isActive: boolean;
  metadata: Record<string, unknown> | null;
}

export interface GameCategoryInfo {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  /** Count of active games in this category that belong to the adapter's provider. */
  gameCount: number;
}

// ─── Method param shapes ──────────────────────────────────────────────────────

export interface ProcessBetParams {
  sessionId: string;
  roundId: string;
  amount: string;
  metadata?: Record<string, unknown>;
}

export interface ProcessWinParams {
  sessionId: string;
  roundId: string;
  amount: string;
  metadata?: Record<string, unknown>;
}

export interface RefundRoundParams {
  sessionId: string;
  roundId: string;
  amount: string;
}

export interface GameCatalogFilter {
  categorySlug?: string;
  isActive?: boolean;
}

// ─── Adapter contract ─────────────────────────────────────────────────────────

export interface ProviderAdapter {
  /** Unique machine-readable identifier, e.g. "html5". Used as the registry key. */
  readonly providerId: string;
  readonly displayName: string;

  /**
   * Verify the player's identity and issue a short-lived game token.
   * @param userId   Platform user ID
   * @param token    Platform auth token (e.g. JWT) for validation
   */
  authenticatePlayer(userId: string, token: string): Promise<PlayerAuthResult>;

  /**
   * Create a new game session. Must be called before launchGame.
   */
  createSession(userId: string, gameId: string, currency?: string): Promise<GameSessionData>;

  /**
   * Build the iframe launch configuration for an existing ACTIVE session.
   */
  launchGame(sessionId: string): Promise<GameLaunchConfig>;

  /**
   * Return the player's current wallet balance. Called by the iframe on load
   * and after each round to display the updated balance.
   */
  syncBalance(userId: string): Promise<BalanceSyncResult>;

  /**
   * Debit the player's wallet for a bet. Idempotent on duplicate roundId.
   */
  processBet(params: ProcessBetParams): Promise<BetResult>;

  /**
   * Credit the player's wallet for a win.
   */
  processWin(params: ProcessWinParams): Promise<WinResult>;

  /**
   * Return a bet to the player (cancelled or voided round).
   */
  refundRound(params: RefundRoundParams): Promise<RefundResult>;

  /**
   * Return the full game catalog for this provider.
   */
  getGameCatalog(filter?: GameCatalogFilter): Promise<GameInfo[]>;

  /**
   * Return all active categories with a game count scoped to this provider.
   */
  getGameCategories(): Promise<GameCategoryInfo[]>;

  /**
   * Update a game's properties (e.g. toggle isActive).
   */
  updateGame(gameId: string, data: { isActive?: boolean }): Promise<GameInfo>;
}
