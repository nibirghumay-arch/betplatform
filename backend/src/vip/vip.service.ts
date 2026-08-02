import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import {
  PLATFORM_EVENTS,
  BetPlacedEvent,
  VipTierPromotedEvent,
} from '../events/platform-events';

@Injectable()
export class VipService {
  private readonly logger = new Logger(VipService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ─── Event listener ────────────────────────────────────────────────────────

  @OnEvent(PLATFORM_EVENTS.BET_PLACED)
  async onBetPlaced(event: BetPlacedEvent): Promise<void> {
    try {
      await this.recordWager(event.userId, event.amount);
    } catch (err: any) {
      this.logger.error(`VIP wager recording failed: userId=${event.userId} error=${err.message}`);
    }
  }

  // ─── Core logic ────────────────────────────────────────────────────────────

  async recordWager(userId: string, amount: string): Promise<void> {
    const wagerDecimal = new Decimal(amount);

    const progress = await this.getOrCreateProgress(userId);
    const newTotal = new Decimal(progress.totalWagerUsd.toString()).plus(wagerDecimal);
    const newPeriod = new Decimal(progress.periodWagerUsd.toString()).plus(wagerDecimal);

    const nextTier = await this.findNextTier(progress.currentTier, newTotal);

    await this.prisma.vipProgress.update({
      where: { userId },
      data: {
        totalWagerUsd: newTotal.toFixed(2),
        periodWagerUsd: newPeriod.toFixed(2),
        ...(nextTier ? { currentTier: nextTier.tier, lastPromotedAt: new Date() } : {}),
      },
    });

    if (nextTier) {
      this.logger.log(`VIP promotion: userId=${userId} tier=${nextTier.tier} name=${nextTier.name}`);
      this.eventEmitter.emit(
        PLATFORM_EVENTS.VIP_TIER_PROMOTED,
        new VipTierPromotedEvent(userId, progress.currentTier, nextTier.tier, nextTier.bonusAmount.toString()),
      );
    }
  }

  async getUserProgress(userId: string) {
    const progress = await this.prisma.vipProgress.findUnique({
      where: { userId },
      include: { vipLevel: true },
    });
    if (!progress) {
      return this.getOrCreateProgress(userId).then(() =>
        this.prisma.vipProgress.findUnique({ where: { userId }, include: { vipLevel: true } }),
      );
    }
    return progress;
  }

  async getLevels() {
    return this.prisma.vipLevel.findMany({
      where: { isActive: true },
      orderBy: { tier: 'asc' },
    });
  }

  async createLevel(params: {
    tier: number;
    name: string;
    minWagerUsd: string;
    bonusAmount: string;
    cashbackRate: string;
  }) {
    return this.prisma.vipLevel.create({
      data: {
        tier: params.tier,
        name: params.name,
        minWagerUsd: params.minWagerUsd,
        bonusAmount: params.bonusAmount,
        cashbackRate: params.cashbackRate,
      },
    });
  }

  async updateLevel(
    tier: number,
    data: Partial<{ name: string; minWagerUsd: string; bonusAmount: string; cashbackRate: string; isActive: boolean }>,
  ) {
    const level = await this.prisma.vipLevel.findUnique({ where: { tier } });
    if (!level) throw new NotFoundException(`VIP level tier ${tier} not found`);
    return this.prisma.vipLevel.update({ where: { tier }, data });
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private async getOrCreateProgress(userId: string) {
    const existing = await this.prisma.vipProgress.findUnique({ where: { userId } });
    if (existing) return existing;
    return this.prisma.vipProgress.create({
      data: { userId, currentTier: 0, totalWagerUsd: '0', periodWagerUsd: '0' },
    });
  }

  private async findNextTier(currentTier: number, newTotal: Decimal) {
    // Find the highest tier whose minWager the user now qualifies for, above current.
    const candidates = await this.prisma.vipLevel.findMany({
      where: {
        isActive: true,
        tier: { gt: currentTier },
        minWagerUsd: { lte: newTotal.toFixed(2) },
      },
      orderBy: { tier: 'desc' },
      take: 1,
    });
    return candidates[0] ?? null;
  }
}
