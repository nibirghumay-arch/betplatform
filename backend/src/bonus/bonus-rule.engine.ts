import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { BonusType } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import {
  PLATFORM_EVENTS,
  UserRegisteredEvent,
  DepositCompletedEvent,
  VipTierPromotedEvent,
  ReferralDepositCompletedEvent,
} from '../events/platform-events';
import { BonusService } from './bonus.service';

export interface RuleConfig {
  amount?: number;
  matchPercent?: number;
  maxAmount?: number;
  wageringMultiplier: number;
  expiryDays?: number;
  currency?: string;
}

@Injectable()
export class BonusRuleEngine {
  private readonly logger = new Logger(BonusRuleEngine.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bonusService: BonusService,
  ) {}

  // ─── Event listeners ───────────────────────────────────────────────────────

  @OnEvent(PLATFORM_EVENTS.USER_REGISTERED)
  async onUserRegistered(event: UserRegisteredEvent): Promise<void> {
    await this.evaluate(event.userId, PLATFORM_EVENTS.USER_REGISTERED, { userId: event.userId });
  }

  @OnEvent(PLATFORM_EVENTS.DEPOSIT_COMPLETED)
  async onDepositCompleted(event: DepositCompletedEvent): Promise<void> {
    await this.evaluate(event.userId, PLATFORM_EVENTS.DEPOSIT_COMPLETED, {
      depositAmount: event.amount,
      currency: event.currency,
    });
  }

  @OnEvent(PLATFORM_EVENTS.VIP_TIER_PROMOTED)
  async onVipTierPromoted(event: VipTierPromotedEvent): Promise<void> {
    await this.evaluate(event.userId, PLATFORM_EVENTS.VIP_TIER_PROMOTED, {
      newTier: event.newTier,
      bonusAmount: event.bonusAmount,
    });
  }

  @OnEvent(PLATFORM_EVENTS.REFERRAL_DEPOSIT_COMPLETED)
  async onReferralDepositCompleted(event: ReferralDepositCompletedEvent): Promise<void> {
    await this.evaluate(event.referredId, PLATFORM_EVENTS.REFERRAL_DEPOSIT_COMPLETED, {
      referrerId: event.referrerId,
      depositAmount: event.depositAmount,
    });
  }

  // ─── Core evaluation ───────────────────────────────────────────────────────

  async evaluate(
    userId: string,
    triggerEvent: string,
    context: Record<string, unknown>,
  ): Promise<void> {
    const now = new Date();

    const rules = await this.prisma.bonusRule.findMany({
      where: {
        triggerEvent,
        isActive: true,
        OR: [{ startsAt: null }, { startsAt: { lte: now } }],
        AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: now } }] }],
      },
      orderBy: { priority: 'desc' },
    });

    for (const rule of rules) {
      await this.applyRule(userId, rule, context);
    }
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private async applyRule(
    userId: string,
    rule: { id: string; bonusType: BonusType; config: unknown; maxClaimsPerUser: number | null; name: string },
    context: Record<string, unknown>,
  ): Promise<void> {
    const config = rule.config as RuleConfig;

    // Per-user claim limit check.
    if (rule.maxClaimsPerUser !== null) {
      const claimCount = await this.prisma.bonusClaim.count({
        where: { userId, bonusRuleId: rule.id },
      });
      if (claimCount >= rule.maxClaimsPerUser) return;
    }

    const amount = this.resolveAmount(config, context);
    if (!amount || amount.lte(0)) return;

    const wageringRequirement = amount.mul(config.wageringMultiplier ?? 1);
    const expiresAt = config.expiryDays
      ? new Date(Date.now() + config.expiryDays * 86400_000)
      : undefined;

    try {
      await this.bonusService.grant({
        userId,
        bonusType: rule.bonusType,
        bonusRuleId: rule.id,
        amount,
        wageringRequirement,
        expiresAt,
        metadata: { triggerContext: context, ruleName: rule.name },
      });
      this.logger.log(`Bonus granted: userId=${userId} rule=${rule.name} amount=${amount.toFixed(2)}`);
    } catch (err: any) {
      this.logger.error(`Bonus grant failed: userId=${userId} rule=${rule.name} error=${err.message}`);
    }
  }

  private resolveAmount(config: RuleConfig, context: Record<string, unknown>): Decimal | null {
    if (config.amount) return new Decimal(config.amount);

    if (config.matchPercent && context.depositAmount) {
      const base = new Decimal(String(context.depositAmount)).mul(config.matchPercent);
      return config.maxAmount ? Decimal.min(base, config.maxAmount) : base;
    }

    if (context.bonusAmount) return new Decimal(String(context.bonusAmount));

    return null;
  }
}
