import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ReportJobStatus, ReportType } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';

export interface ReportParams {
  from: string; // ISO date
  to: string;   // ISO date
  gameId?: string;
  groupBy?: 'day' | 'month';
}

export interface RevenueReportRow {
  period: string;
  ggr: string;
  ngr: string;
  totalDeposits: string;
  totalWithdrawals: string;
}

export interface PlayerReportData {
  totalPlayers: number;
  activePlayers: number;
  newPlayers: number;
  avgLifetimeValue: string;
  churnRiskCount: number;
}

export interface GameReportRow {
  gameId: string;
  gameName: string;
  roundsPlayed: number;
  totalBet: string;
  totalWin: string;
  rtp: string;
}

@Injectable()
export class ReportingService {
  private readonly logger = new Logger(ReportingService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Job lifecycle ─────────────────────────────────────────────────────────

  async queueReport(type: ReportType, params: ReportParams, requestedBy: string) {
    const job = await this.prisma.reportJob.create({
      data: { reportType: type, params: params as any, requestedBy },
    });
    setImmediate(() => this.processJob(job.id).catch((e) => this.logger.error(`Report job ${job.id} failed`, e)));
    return job;
  }

  async processJob(jobId: string): Promise<void> {
    const job = await this.prisma.reportJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException(`Report job ${jobId} not found`);

    await this.prisma.reportJob.update({
      where: { id: jobId },
      data: { status: ReportJobStatus.RUNNING, startedAt: new Date() },
    });

    try {
      const params = job.params as unknown as ReportParams;
      let csv: string;
      if (job.reportType === ReportType.REVENUE) {
        const rows = await this.getRevenueReport(new Date(params.from), new Date(params.to), params.groupBy);
        csv = this.toCsv(rows as unknown as Record<string, unknown>[]);
      } else if (job.reportType === ReportType.PLAYER) {
        const data = await this.getPlayerReport(new Date(params.from), new Date(params.to));
        csv = this.toCsv([data as unknown as Record<string, unknown>]);
      } else {
        const rows = await this.getGameReport(new Date(params.from), new Date(params.to), params.gameId);
        csv = this.toCsv(rows as unknown as Record<string, unknown>[]);
      }

      await this.prisma.reportJob.update({
        where: { id: jobId },
        data: {
          status: ReportJobStatus.COMPLETED,
          completedAt: new Date(),
          resultUrl: `data:text/csv;base64,${Buffer.from(csv).toString('base64')}`,
        },
      });
    } catch (err: any) {
      await this.prisma.reportJob.update({
        where: { id: jobId },
        data: { status: ReportJobStatus.FAILED, completedAt: new Date(), errorMsg: err.message },
      });
      throw err;
    }
  }

  async getJob(jobId: string) {
    const job = await this.prisma.reportJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException(`Report job ${jobId} not found`);
    return job;
  }

  async listJobs(requestedBy: string) {
    return this.prisma.reportJob.findMany({
      where: { requestedBy },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  // ─── Revenue report ────────────────────────────────────────────────────────

  async getRevenueReport(from: Date, to: Date, groupBy: 'day' | 'month' = 'day'): Promise<RevenueReportRow[]> {
    const fmt = groupBy === 'month' ? 'YYYY-MM' : 'YYYY-MM-DD';

    const rows = await this.prisma.$queryRaw<
      { period: string; type: string; total: string }[]
    >`
      SELECT
        TO_CHAR(created_at, ${fmt})    AS period,
        type,
        SUM(amount)::text              AS total
      FROM transactions
      WHERE status = 'COMPLETED'
        AND created_at BETWEEN ${from} AND ${to}
        AND type IN ('DEPOSIT','WITHDRAWAL','BET','WIN','BONUS_CREDIT')
      GROUP BY period, type
      ORDER BY period
    `;

    const map = new Map<string, Record<string, Decimal>>();
    for (const row of rows) {
      if (!map.has(row.period)) map.set(row.period, {});
      map.get(row.period)![row.type] = new Decimal(row.total ?? '0');
    }

    return Array.from(map.entries()).map(([period, t]) => {
      const bet = t['BET'] ?? new Decimal(0);
      const win = t['WIN'] ?? new Decimal(0);
      const bonus = t['BONUS_CREDIT'] ?? new Decimal(0);
      const ggr = bet.minus(win);
      return {
        period,
        ggr: ggr.toFixed(2),
        ngr: ggr.minus(bonus).toFixed(2),
        totalDeposits: (t['DEPOSIT'] ?? new Decimal(0)).toFixed(2),
        totalWithdrawals: (t['WITHDRAWAL'] ?? new Decimal(0)).toFixed(2),
      };
    });
  }

  // ─── Player report ─────────────────────────────────────────────────────────

  async getPlayerReport(from: Date, to: Date): Promise<PlayerReportData> {
    const [totalPlayers, newPlayers, activePlayers, churnRiskCount, ltv] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { createdAt: { gte: from, lte: to } } }),
      this.prisma.user.count({
        where: { deposits: { some: { createdAt: { gte: from, lte: to }, status: 'COMPLETED' } } },
      }),
      this.prisma.user.count({
        where: {
          deposits: { none: { createdAt: { gte: new Date(Date.now() - 30 * 86400_000) } } },
          createdAt: { lt: new Date(Date.now() - 30 * 86400_000) },
        },
      }),
      this.prisma.$queryRaw<{ avg: string }[]>`
        SELECT AVG(player_total)::text AS avg
        FROM (
          SELECT SUM(amount) AS player_total
          FROM transactions
          WHERE type = 'DEPOSIT' AND status = 'COMPLETED'
          GROUP BY initiated_by
        ) sub
      `,
    ]);

    return {
      totalPlayers,
      activePlayers,
      newPlayers,
      avgLifetimeValue: new Decimal(ltv[0]?.avg ?? '0').toFixed(2),
      churnRiskCount,
    };
  }

  // ─── Game report ───────────────────────────────────────────────────────────

  async getGameReport(from: Date, to: Date, gameId?: string): Promise<GameReportRow[]> {
    const rows = gameId
      ? await this.prisma.$queryRaw<
          { game_id: string; game_name: string; rounds: string; total_bet: string; total_win: string }[]
        >`
          SELECT
            gs.game_id,
            gd.name            AS game_name,
            COUNT(DISTINCT gs.id)::text AS rounds,
            COALESCE(SUM(CASE WHEN t.type = 'BET'  THEN t.amount ELSE 0 END), 0)::text AS total_bet,
            COALESCE(SUM(CASE WHEN t.type = 'WIN'  THEN t.amount ELSE 0 END), 0)::text AS total_win
          FROM game_sessions gs
          JOIN game_definitions gd ON gd.id = gs.game_id
          JOIN transactions t ON t.game_round_id = gs.id
            AND t.status = 'COMPLETED'
            AND t.created_at BETWEEN ${from} AND ${to}
          WHERE gs.started_at BETWEEN ${from} AND ${to}
            AND gs.game_id = ${gameId}
          GROUP BY gs.game_id, gd.name
          ORDER BY total_bet DESC
        `
      : await this.prisma.$queryRaw<
          { game_id: string; game_name: string; rounds: string; total_bet: string; total_win: string }[]
        >`
          SELECT
            gs.game_id,
            gd.name            AS game_name,
            COUNT(DISTINCT gs.id)::text AS rounds,
            COALESCE(SUM(CASE WHEN t.type = 'BET'  THEN t.amount ELSE 0 END), 0)::text AS total_bet,
            COALESCE(SUM(CASE WHEN t.type = 'WIN'  THEN t.amount ELSE 0 END), 0)::text AS total_win
          FROM game_sessions gs
          JOIN game_definitions gd ON gd.id = gs.game_id
          JOIN transactions t ON t.game_round_id = gs.id
            AND t.status = 'COMPLETED'
            AND t.created_at BETWEEN ${from} AND ${to}
          WHERE gs.started_at BETWEEN ${from} AND ${to}
          GROUP BY gs.game_id, gd.name
          ORDER BY total_bet DESC
        `;

    return rows.map((r) => {
      const bet = new Decimal(r.total_bet);
      const win = new Decimal(r.total_win);
      const rtp = bet.isZero() ? '0.00' : win.div(bet).times(100).toFixed(2);
      return {
        gameId: r.game_id,
        gameName: r.game_name,
        roundsPlayed: Number(r.rounds),
        totalBet: bet.toFixed(2),
        totalWin: win.toFixed(2),
        rtp,
      };
    });
  }

  // ─── CSV export ────────────────────────────────────────────────────────────

  toCsv(rows: Record<string, unknown>[]): string {
    if (rows.length === 0) return '';
    const headers = Object.keys(rows[0]);
    const lines = [
      headers.join(','),
      ...rows.map((r) =>
        headers.map((h) => {
          const v = String(r[h] ?? '');
          return v.includes(',') ? `"${v}"` : v;
        }).join(','),
      ),
    ];
    return lines.join('\n');
  }
}
