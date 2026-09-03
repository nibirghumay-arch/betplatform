import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { CronController } from './cron.controller';

@Module({
  imports: [AnalyticsModule],
  controllers: [CronController],
})
export class CronModule {}
