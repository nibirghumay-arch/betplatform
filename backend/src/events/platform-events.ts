// Canonical event names emitted via NestJS EventEmitter.
// All listeners and emitters must use these constants.

export const PLATFORM_EVENTS = {
  USER_REGISTERED: 'user.registered',
  DEPOSIT_COMPLETED: 'deposit.completed',
  BET_PLACED: 'bet.placed',
  VIP_TIER_PROMOTED: 'vip.tier.promoted',
  REFERRAL_DEPOSIT_COMPLETED: 'referral.deposit.completed',
  WITHDRAWAL_APPROVED: 'withdrawal.approved',
  WITHDRAWAL_REJECTED: 'withdrawal.rejected',
  BONUS_AWARDED: 'bonus.awarded',
  ACCOUNT_LOCKED: 'account.locked',
} as const;

export type PlatformEventName = (typeof PLATFORM_EVENTS)[keyof typeof PLATFORM_EVENTS];

// ─── Event payloads ───────────────────────────────────────────────────────────

export class UserRegisteredEvent {
  constructor(
    public readonly userId: string,
    public readonly referralCode?: string,
  ) {}
}

export class DepositCompletedEvent {
  constructor(
    public readonly userId: string,
    public readonly depositId: string,
    public readonly amount: string,
    public readonly currency: string,
  ) {}
}

export class BetPlacedEvent {
  constructor(
    public readonly userId: string,
    public readonly amount: string,
    public readonly currency: string,
    public readonly gameRoundId: string,
  ) {}
}

export class VipTierPromotedEvent {
  constructor(
    public readonly userId: string,
    public readonly previousTier: number,
    public readonly newTier: number,
    public readonly bonusAmount: string,
  ) {}
}

export class ReferralDepositCompletedEvent {
  constructor(
    public readonly referrerId: string,
    public readonly referredId: string,
    public readonly referralId: string,
    public readonly depositAmount: string,
  ) {}
}

export class WithdrawalApprovedEvent {
  constructor(
    public readonly userId: string,
    public readonly withdrawalId: string,
    public readonly amount: string,
    public readonly currency: string,
  ) {}
}

export class WithdrawalRejectedEvent {
  constructor(
    public readonly userId: string,
    public readonly withdrawalId: string,
    public readonly reason?: string,
  ) {}
}

export class BonusAwardedEvent {
  constructor(
    public readonly userId: string,
    public readonly bonusId: string,
    public readonly amount: string,
    public readonly bonusType: string,
  ) {}
}

export class AccountLockedEvent {
  constructor(public readonly userId: string) {}
}
