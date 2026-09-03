import { Controller, HttpCode, HttpStatus, Headers, Logger, Post, UnauthorizedException } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import { Public } from '../auth/decorators/public.decorator';
import { AnalyticsService } from '../analytics/analytics.service';

// ============================================================
// Endpoints for Netlify Scheduled Functions.
//
// A frozen Lambda container cannot run in-process timers, so the
// @Cron() jobs in this codebase are driven from outside instead:
// netlify/functions/*.mts wakes up on a schedule and calls in here
// with CRON_SECRET. Public to JWT auth, guarded by that secret.
// ============================================================

@ApiExcludeController()
@Controller('internal/cron')
export class CronController {
  private readonly logger = new Logger(CronController.name);

  constructor(
    private readonly analytics: AnalyticsService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('analytics-snapshot')
  @HttpCode(HttpStatus.OK)
  async analyticsSnapshot(@Headers('authorization') authorization?: string) {
    this.assertCronSecret(authorization);

    const day = new Date();
    day.setDate(day.getDate() - 1);
    day.setHours(0, 0, 0, 0);

    await this.analytics.takeSnapshot(day);
    const snapshotDate = day.toISOString().slice(0, 10);
    this.logger.log(`Analytics snapshot taken for ${snapshotDate}`);

    return { ok: true, snapshotDate };
  }

  private assertCronSecret(authorization?: string): void {
    const expected = this.config.get<string>('CRON_SECRET') ?? '';
    if (!expected) {
      // Fail closed: an unset secret must not mean "open to the internet".
      this.logger.error('CRON_SECRET is not configured — refusing cron request');
      throw new UnauthorizedException('Cron endpoint is not configured');
    }

    const given = (authorization ?? '').startsWith('Bearer ')
      ? authorization!.slice('Bearer '.length).trim()
      : '';

    const a = Buffer.from(given);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Invalid cron secret');
    }
  }
}
