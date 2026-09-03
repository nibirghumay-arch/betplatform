import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { AuditModule } from './audit/audit.module';
import { LedgerModule } from './ledger/ledger.module';
import { WalletModule } from './wallet/wallet.module';
import { TransactionModule } from './transaction/transaction.module';
import { GamesModule } from './games/games.module';
import { ProviderModule } from './provider/provider.module';
import { PaymentModule } from './payment/payment.module';
import { SystemSettingsModule } from './system-settings/system-settings.module';
import { ReferralModule } from './referral/referral.module';
import { VipModule } from './vip/vip.module';
import { BonusModule } from './bonus/bonus.module';
import { ReportingModule } from './reporting/reporting.module';
import { NotificationModule } from './notification/notification.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { UsersModule } from './users/users.module';
import { CronModule } from './cron/cron.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    EventEmitterModule.forRoot({ wildcard: false, delimiter: '.', global: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuditModule,
    LedgerModule,
    WalletModule,
    TransactionModule,
    GamesModule,
    ProviderModule,
    PaymentModule,
    SystemSettingsModule,
    ReferralModule,
    VipModule,
    BonusModule,
    ReportingModule,
    NotificationModule,
    AnalyticsModule,
    UsersModule,
    AuthModule,
    // Serverless replacement for the in-process @Cron jobs.
    CronModule,
    HealthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }],
})
export class AppModule {}
