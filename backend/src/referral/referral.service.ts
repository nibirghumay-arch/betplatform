import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ReferralRewardStatus } from '@prisma/client';
import Decimal from 'decimal.js';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../prisma/prisma.service';
import { SystemSettingsService } from '../system-settings/system-settings.service';
import { TransactionService } from '../transaction/transaction.service';
import {
  PLATFORM_EVENTS,
  ReferralDepositCompletedEvent,
} from '../events/platform-events';

// ─── Setting keys ─────────────────────────────────────────────────────────────
const SETTING_COMMISSION_RATE = 'referral.commission_rate';
const SETTING_REFERRER_BONUS = 'referral.referrer_bonus_amount';
const SETTING_REFERRED_BONUS = 'referral.referred_bonus_amount';

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class ReferralService {
  private readonly logger = new Logger(ReferralService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SystemSettingsService,
    private readonly transactionService: TransactionService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ─── Code management ───────────────────────────────────────────────────────

  async generateCode(userId: string): Promise<string> {
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { referralCode: true },
    });
    if (!existing) throw new NotFoundException(`User ${userId} not found`);
    if (existing.referralCode) return existing.referralCode;

    const code = this.buildCode(userId);
    await this.prisma.user.update({ where: { id: userId }, data: { referralCode: code } });
    this.logger.log(`Referral code generated: userId=${userId} code=${code}`);
    return code;
  }

  async applyReferralCode(newUserId: string, code: string): Promise<void> {
    const referrer = await this.prisma.user.findUnique({
      where: { referralCode: code },
      select: { id: true },
    });
    if (!referrer) throw new NotFoundException(`Referral code '${code}' not found`);
    if (referrer.id === newUserId) throw new BadRequestException('Cannot refer yourself');

    const alreadyReferred = await this.prisma.referral.findUnique({
      where: { referredId: newUserId },
    });
    if (alreadyReferred) throw new ConflictException('User has already been referred');

    await this.prisma.referral.create({
      data: { referrerId: referrer.id, referredId: newUserId, code },
    });
    this.logger.log(`Referral linked: referrer=${referrer.id} referred=${newUserId}`);
  }

  // ─── Commission payout on first deposit ────────────────────────────────────

  async processDepositCommission(referredUserId: string, depositAmount: string): Promise<void> {
    const referral = await this.prisma.referral.findUnique({
      where: { referredId: referredUserId },
    });
    if (!referral) return;

    // Only pay commission once (first deposit).
    const alreadyPaid = await this.prisma.referralReward.findFirst({
      where: { referralId: referral.id, rewardType: 'REFERRER_COMMISSION', status: { not: ReferralRewardStatus.CANCELLED } },
    });
    if (alreadyPaid) return;

    const commissionRate = await this.settings.getNumber(SETTING_COMMISSION_RATE, 0.05);
    const referrerBonusFlat = await this.settings.getNumber(SETTING_REFERRER_BONUS, 0);
    const referredBonus = await this.settings.getNumber(SETTING_REFERRED_BONUS, 0);

    const commission = new Decimal(depositAmount).mul(commissionRate).toDecimalPlaces(8);

    await this.payReward({
      referralId: referral.id,
      userId: referral.referrerId,
      amount: commission,
      rewardType: 'REFERRER_COMMISSION',
      description: `Referral commission: ${commission.toFixed(2)} on deposit by ${referredUserId}`,
    });

    if (new Decimal(referrerBonusFlat).gt(0)) {
      await this.payReward({
        referralId: referral.id,
        userId: referral.referrerId,
        amount: new Decimal(referrerBonusFlat),
        rewardType: 'REFERRER_BONUS',
        description: `Referral bonus for referring ${referredUserId}`,
      });
    }

    if (new Decimal(referredBonus).gt(0)) {
      await this.payReward({
        referralId: referral.id,
        userId: referredUserId,
        amount: new Decimal(referredBonus),
        rewardType: 'REFERRED_BONUS',
        description: 'Welcome bonus for using a referral code',
      });
    }

    // Mark referral completed.
    await this.prisma.referral.update({
      where: { id: referral.id },
      data: { completedAt: new Date() },
    });

    this.eventEmitter.emit(
      PLATFORM_EVENTS.REFERRAL_DEPOSIT_COMPLETED,
      new ReferralDepositCompletedEvent(referral.referrerId, referredUserId, referral.id, depositAmount),
    );
  }

  // ─── Queries ───────────────────────────────────────────────────────────────

  async getMyReferrals(userId: string, skip = 0, take = 20) {
    return this.prisma.referral.findMany({
      where: { referrerId: userId },
      include: { rewards: { select: { rewardType: true, amount: true, status: true } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
  }

  async getMyRewards(userId: string, skip = 0, take = 20) {
    return this.prisma.referralReward.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
  }

  async getMyCode(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { referralCode: true },
    });
    if (!user) throw new NotFoundException(`User ${userId} not found`);
    return user.referralCode ?? (await this.generateCode(userId));
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private async payReward(params: {
    referralId: string;
    userId: string;
    amount: Decimal;
    rewardType: string;
    description: string;
  }): Promise<void> {
    const reward = await this.prisma.referralReward.create({
      data: {
        referralId: params.referralId,
        userId: params.userId,
        amount: params.amount.toFixed(8),
        rewardType: params.rewardType,
        status: ReferralRewardStatus.PENDING,
      },
    });

    try {
      const result = await this.transactionService.bonusCredit({
        userId: params.userId,
        amount: params.amount,
        reference: `referral_reward:${reward.id}`,
        description: params.description,
      });

      await this.prisma.referralReward.update({
        where: { id: reward.id },
        data: {
          status: ReferralRewardStatus.PAID,
          transactionId: result.transactionId,
          paidAt: new Date(),
        },
      });
      this.logger.log(`Referral reward paid: rewardId=${reward.id} userId=${params.userId} amount=${params.amount.toFixed(2)} type=${params.rewardType}`);
    } catch (err: any) {
      await this.prisma.referralReward.update({
        where: { id: reward.id },
        data: { status: ReferralRewardStatus.CANCELLED },
      });
      this.logger.error(`Referral reward failed: rewardId=${reward.id} error=${err.message}`);
    }
  }

  private buildCode(userId: string): string {
    // Deterministic prefix from userId + random suffix for uniqueness.
    return `${userId.slice(-4).toUpperCase()}${uuidv4().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
  }
}
