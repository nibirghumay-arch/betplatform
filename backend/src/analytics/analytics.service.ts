import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { GameSessionStatus, TransactionStatus, TransactionType } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';

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

export interface PlayerSegment {
  segment: 'high_roller' | 'dormant' | 'new';
  count: number;
  userIds: string[];
}

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Daily snapshot cron ───────────────────────────────────────────────────

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async scheduledSnapshot(): Promise<void> {
    // On Netlify the container is frozen between requests, so this timer is
    // unreliable — netlify/functions/daily-snapshot.mts drives the snapshot
    // through POST /api/v1/internal/cron/analytics-snapshot instead. Running
    // both would double-write the same row.
    if (process.env.NETLIFY === 'true' || process.env.DISABLE_IN_PROCESS_CRON === 'true') {
      return;
    }

    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);
      await this.takeSnapshot(yesterday);
      this.logger.log(`Analytics snapshot taken for ${yesterday.toISOString().slice(0, 10)}`);
    } catch (err) {
      this.logger.error('Scheduled snapshot failed', err);
    }
  }

  async takeSnapshot(date: Date = new Date()): Promise<void> {
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    const [totalPlayers, newPlayers, activePlayers, txAgg, totalBets] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { createdAt: { gte: dayStart, lte: dayEnd } } }),
      this.prisma.user.count({
        where: {
          deposits: { some: { createdAt: { gte: dayStart, lte: dayEnd }, status: 'COMPLETED' } },
        },
      }),
      this.prisma.transaction.groupBy({
        by: ['type'],
        where: {
          status: TransactionStatus.COMPLETED,
          createdAt: { gte: dayStart, lte: dayEnd },
          type: { in: [TransactionType.DEPOSIT, TransactionType.WITHDRAWAL, TransactionType.BET, TransactionType.WIN] },
        },
        _sum: { amount: true },
      }),
      this.prisma.transaction.count({
        where: {
          type: TransactionType.BET,
          status: TransactionStatus.COMPLETED,
          createdAt: { gte: dayStart, lte: dayEnd },
        },
      }),
    ]);

    const sum = (type: TransactionType) => {
      const row = txAgg.find((r) => r.type === type);
      return new Decimal((row?._sum?.amount as any) ?? '0');
    };

    const totalDeposits = sum(TransactionType.DEPOSIT);
    const totalWithdrawals = sum(TransactionType.WITHDRAWAL);
    const ggr = sum(TransactionType.BET).minus(sum(TransactionType.WIN));

    const snapshotDate = new Date(dayStart);
    snapshotDate.setHours(0, 0, 0, 0);

    await this.prisma.analyticsSnapshot.upsert({
      where: { snapshotDate },
      create: {
        snapshotDate,
        totalPlayers,
        activePlayers,
        newPlayers,
        ggr: ggr.toFixed(2),
        totalDeposits: totalDeposits.toFixed(2),
        totalWithdrawals: totalWithdrawals.toFixed(2),
        totalBets,
        activeSessions: 0,
      },
      update: {
        totalPlayers,
        activePlayers,
        newPlayers,
        ggr: ggr.toFixed(2),
        totalDeposits: totalDeposits.toFixed(2),
        totalWithdrawals: totalWithdrawals.toFixed(2),
        totalBets,
      },
    });
  }

  // ─── Dashboard stats ───────────────────────────────────────────────────────

  async getDashboardStats(): Promise<DashboardStats> {
    const [latest, activeSessions] = await Promise.all([
      this.prisma.analyticsSnapshot.findFirst({ orderBy: { snapshotDate: 'desc' } }),
      this.prisma.gameSession.count({ where: { status: GameSessionStatus.ACTIVE } }),
    ]);

    return {
      snapshot: latest
        ? {
            snapshotDate: latest.snapshotDate.toISOString().slice(0, 10),
            totalPlayers: latest.totalPlayers,
            activePlayers: latest.activePlayers,
            newPlayers: latest.newPlayers,
            ggr: latest.ggr.toString(),
            totalDeposits: latest.totalDeposits.toString(),
            totalWithdrawals: latest.totalWithdrawals.toString(),
            totalBets: latest.totalBets,
          }
        : null,
      activeSessions,
    };
  }

  // ─── Player segmentation ───────────────────────────────────────────────────

  async getSegments(): Promise<PlayerSegment[]> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000);
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000);
    const highRollerThreshold = '1000';

    const [highRollers, dormant, newUsers] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          deposits: {
            some: { status: 'COMPLETED', amount: { gte: highRollerThreshold } },
          },
        },
        select: { id: true },
      }),
      this.prisma.user.findMany({
        where: {
          createdAt: { lt: thirtyDaysAgo },
          deposits: { none: { createdAt: { gte: thirtyDaysAgo } } },
        },
        select: { id: true },
      }),
      this.prisma.user.findMany({
        where: { createdAt: { gte: sevenDaysAgo } },
        select: { id: true },
      }),
    ]);

    return [
      { segment: 'high_roller', count: highRollers.length, userIds: highRollers.map((u) => u.id) },
      { segment: 'dormant', count: dormant.length, userIds: dormant.map((u) => u.id) },
      { segment: 'new', count: newUsers.length, userIds: newUsers.map((u) => u.id) },
    ];
  }

  // ─── Snapshot history ──────────────────────────────────────────────────────

  async getSnapshotHistory(days = 30) {
    return this.prisma.analyticsSnapshot.findMany({
      orderBy: { snapshotDate: 'desc' },
      take: days,
    });
  }
}
