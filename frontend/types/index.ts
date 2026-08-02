export interface User {
  id: string;
  email: string;
  username: string;
  role: string;
  status: string;
  emailVerified: boolean;
  referralCode?: string;
  createdAt: string;
}

export interface AuthTokens {
  access_token: string;
  user: User;
}

export interface Wallet {
  id: string;
  balance: string;
  currency: string;
}

export interface Transaction {
  id: string;
  type: string;
  amount: string;
  status: string;
  description?: string;
  createdAt: string;
}

export interface Deposit {
  id: string;
  amount: string;
  currency: string;
  status: string;
  provider: string;
  checkoutUrl?: string;
  paymentChannel?: string;
  createdAt: string;
}

export type PaymentMethodType =
  | 'BKASH'
  | 'NAGAD'
  | 'ROCKET'
  | 'UPAY'
  | 'MCASH'
  | 'TAP'
  | 'BANK'
  | 'CARD';

export interface PaymentMethod {
  id: string;
  userId: string;
  type: PaymentMethodType;
  accountNumber: string;
  accountHolder?: string;
  bankName?: string;
  branchName?: string;
  routingNumber?: string;
  label?: string;
  isDefault: boolean;
  isVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

// Mobile financial services offered through SSLCommerz — used to drive the
// deposit-provider picker and the "add payment method" form.
export const MOBILE_WALLET_TYPES: PaymentMethodType[] = [
  'BKASH',
  'NAGAD',
  'ROCKET',
  'UPAY',
  'MCASH',
  'TAP',
];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethodType, string> = {
  BKASH: 'bKash',
  NAGAD: 'Nagad',
  ROCKET: 'Rocket',
  UPAY: 'Upay',
  MCASH: 'mCash',
  TAP: 'Tap',
  BANK: 'Bank Account',
  CARD: 'Card',
};

export interface GameCategory {
  id: string;
  name: string;
  slug: string;
  description?: string;
}

export interface GameDefinition {
  id: string;
  name: string;
  slug: string;
  providerId: string;
  categoryId: string;
  thumbnailUrl?: string;
  rtp?: string | number;
  description?: string;
  featured?: boolean;
  category?: GameCategory;
}

export interface GameSession {
  id: string;
  gameId: string;
  status: string;
  launchUrl?: string;
  createdAt: string;
}

export interface VipProgress {
  totalWager: string;
  periodWager: string;
  currentTier: number;
}

export interface Bonus {
  id: string;
  bonusType: string;
  amount: string;
  wageringRequired: string;
  wageringCompleted: string;
  status: string;
  expiresAt?: string;
  createdAt: string;
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  status: string;
  readAt?: string;
  createdAt: string;
}

// ─── Admin types ───────────────────────────────────────────────────────────

export interface WithdrawalItem {
  id: string;
  userId: string;
  amount: string;
  currency: string;
  status: string;
  pspProvider: string;
  payoutDetails?: Record<string, unknown>;
  paymentMethodId?: string;
  rejectionReason?: string;
  createdAt: string;
}

export interface BonusRule {
  id: string;
  name: string;
  bonusType: string;
  triggerEvent: string;
  config: Record<string, unknown>;
  isActive: boolean;
  priority: number;
  maxClaimsPerUser?: number;
  startsAt?: string;
  endsAt?: string;
  createdAt: string;
}

export interface AuditLogEntry {
  id: string;
  userId?: string;
  action: string;
  resource: string;
  resourceId?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  createdAt: string;
}

export interface DashboardStats {
  snapshot: {
    snapshotDate: string;
    totalPlayers: number;
    activePlayers: number;
    newPlayers: number;
    ggr: string;
    totalDeposits: string;
    totalWithdrawals: string;
    totalBets: number;
  } | null;
  activeSessions: number;
}

export interface AnalyticsSnapshot {
  snapshotDate: string;
  totalPlayers: number;
  activePlayers: number;
  newPlayers: number;
  ggr: string;
  totalDeposits: string;
  totalWithdrawals: string;
  totalBets: number;
}

export interface RevenueRow {
  period: string;
  ggr: string;
  ngr: string;
  totalDeposits: string;
  totalWithdrawals: string;
}

export interface PlayerSegment {
  segment: 'high_roller' | 'dormant' | 'new';
  count: number;
  userIds: string[];
}
