import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { BonusStatus, BonusType } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionService } from '../transaction/transaction.service';
import { PLATFORM_EVENTS, BetPlacedEvent } from '../events/platform-events';

export interface GrantBonusParams {
  userId: string;
  bonusType: BonusType;
  bonusRuleId?: string;
  amount: Decimal;
  wageringRequirement: Decimal;
  expiresAt?: Date;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class BonusService {
  private readonly logger = new Logger(BonusService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly transactionService: TransactionService,
  ) {}

  // ─── Event listener: track wagering progress ───────────────────────────────

  @OnEvent(PLATFORM_EVENTS.BET_PLACED)
  async onBetPlaced(event: BetPlacedEvent): Promise<void> {
    try {
      await this.recordWagering(event.userId, event.amount);
    } catch (err: any) {
      this.logger.error(`Bonus wagering update failed: userId=${event.userId} error=${err.message}`);
    }
  }

  // ─── Grant ─────────────────────────────────────────────────────────────────

  async grant(params: GrantBonusParams): Promise<void> {
    const bonus = await this.prisma.bonus.create({
      data: {
        userId: params.userId,
        bonusType: params.bonusType,
        bonusRuleId: params.bonusRuleId ?? null,
        status: BonusStatus.ACTIVE,
        amount: params.amount.toFixed(8),
        wageringRequirement: params.wageringRequirement.toFixed(8),
        wageredAmount: '0',
        expiresAt: params.expiresAt ?? null,
        activatedAt: new Date(),
        metadata: (params.metadata ?? null) as any,
      },
    });

    // Record claim for per-user limit tracking.
    if (params.bonusRuleId) {
      await this.prisma.bonusClaim.create({
        data: { userId: params.userId, bonusRuleId: params.bonusRuleId, bonusId: bonus.id },
      });
    }

    // Credit the user's wallet immediately.
    try {
      const result = await this.transactionService.bonusCredit({
        userId: params.userId,
        amount: params.amount,
        reference: `bonus:${bonus.id}`,
        description: `${params.bonusType} bonus`,
        initiatedBy: 'system',
      });

      await this.prisma.bonus.update({
        where: { id: bonus.id },
        data: { transactionId: result.transactionId },
      });
    } catch (err: any) {
      await this.prisma.bonus.update({
        where: { id: bonus.id },
        data: { status: BonusStatus.CANCELLED },
      });
      throw err;
    }
  }

  // ─── Wagering requirement tracking ─────────────────────────────────────────

  async recordWagering(userId: string, betAmount: string): Promise<void> {
    const activeBonuses = await this.prisma.bonus.findMany({
      where: { userId, status: { in: [BonusStatus.ACTIVE, BonusStatus.WAGERING] } },
    });

    for (const bonus of activeBonuses) {
      const newWagered = new Decimal(bonus.wageredAmount.toString()).plus(betAmount);
      const requirement = new Decimal(bonus.wageringRequirement.toString());
      const isComplete = newWagered.gte(requirement);

      await this.prisma.bonus.update({
        where: { id: bonus.id },
        data: {
          wageredAmount: newWagered.toFixed(8),
          status: isComplete ? BonusStatus.COMPLETED : BonusStatus.WAGERING,
          completedAt: isComplete ? new Date() : null,
        },
      });

      if (isComplete) {
        this.logger.log(`Bonus wagering complete: bonusId=${bonus.id} userId=${userId}`);
      }
    }
  }

  // ─── Expiry ────────────────────────────────────────────────────────────────

  async expireOverdueBonuses(): Promise<number> {
    const result = await this.prisma.bonus.updateMany({
      where: {
        status: { in: [BonusStatus.ACTIVE, BonusStatus.WAGERING] },
        expiresAt: { lt: new Date() },
      },
      data: { status: BonusStatus.EXPIRED },
    });
    if (result.count > 0) {
      this.logger.warn(`Expired ${result.count} overdue bonuses`);
    }
    return result.count;
  }

  async forfeit(bonusId: string, adminId: string): Promise<void> {
    const bonus = await this.prisma.bonus.findUnique({ where: { id: bonusId } });
    if (!bonus) throw new NotFoundException(`Bonus ${bonusId} not found`);
    if (bonus.status === BonusStatus.COMPLETED || bonus.status === BonusStatus.FORFEITED) {
      throw new BadRequestException(`Bonus is already ${bonus.status}`);
    }

    const remaining = new Decimal(bonus.amount.toString()).minus(bonus.wageredAmount.toString());
    if (remaining.gt(0)) {
      await this.transactionService.bonusDebit({
        userId: bonus.userId,
        amount: remaining,
        reference: `bonus_forfeit:${bonusId}`,
        description: `Admin forfeit of bonus ${bonusId}`,
        initiatedBy: adminId,
      });
    }

    await this.prisma.bonus.update({
      where: { id: bonusId },
      data: { status: BonusStatus.FORFEITED },
    });
    this.logger.warn(`Bonus forfeited: bonusId=${bonusId} by admin=${adminId}`);
  }

  // ─── Queries ───────────────────────────────────────────────────────────────

  async getUserBonuses(userId: string, skip = 0, take = 20) {
    return this.prisma.bonus.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
  }

  async getActiveBonus(userId: string) {
    return this.prisma.bonus.findFirst({
      where: { userId, status: { in: [BonusStatus.ACTIVE, BonusStatus.WAGERING] } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getAdminBonusRules(skip = 0, take = 50) {
    return this.prisma.bonusRule.findMany({
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      skip,
      take,
    });
  }

  async createBonusRule(data: {
    name: string;
    bonusType: BonusType;
    triggerEvent: string;
    config: Record<string, unknown>;
    priority?: number;
    startsAt?: Date;
    endsAt?: Date;
    maxClaimsPerUser?: number;
  }) {
    return this.prisma.bonusRule.create({ data: data as any });
  }

  async toggleBonusRule(ruleId: string, isActive: boolean) {
    const rule = await this.prisma.bonusRule.findUnique({ where: { id: ruleId } });
    if (!rule) throw new NotFoundException(`Bonus rule ${ruleId} not found`);
    return this.prisma.bonusRule.update({ where: { id: ruleId }, data: { isActive } });
  }
}
