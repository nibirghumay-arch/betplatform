import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'stdout', level: 'error' },
        { emit: 'stdout', level: 'warn' },
      ],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    await this.enforceBdtOnlyCurrency();
    this.logger.log('Database connected; platform currency is BDT');
  }

  /**
   * One-time data-only migration for existing databases. It changes currency
   * labels to BDT but deliberately leaves every numeric amount unchanged.
   * The internal system-setting marker plus advisory lock keeps this safe for
   * concurrent serverless cold starts; no schema DDL is required here.
   */
  private async enforceBdtOnlyCurrency(): Promise<void> {
    const migrationKey = '__internal.platform_currency_bdt_v1';

    await this.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(74003211)`;
      const marker = await tx.systemSetting.findUnique({
        where: { key: migrationKey },
        select: { key: true },
      });
      if (marker) return;

      await tx.$executeRaw`UPDATE "wallets" SET "currency" = 'BDT' WHERE "currency" IS DISTINCT FROM 'BDT'`;
      await tx.$executeRaw`UPDATE "ledger_entries" SET "currency" = 'BDT' WHERE "currency" IS DISTINCT FROM 'BDT'`;
      await tx.$executeRaw`UPDATE "transactions" SET "currency" = 'BDT' WHERE "currency" IS DISTINCT FROM 'BDT'`;
      await tx.$executeRaw`UPDATE "game_sessions" SET "currency" = 'BDT' WHERE "currency" IS DISTINCT FROM 'BDT'`;
      await tx.$executeRaw`UPDATE "deposits" SET "currency" = 'BDT' WHERE "currency" IS DISTINCT FROM 'BDT'`;
      await tx.$executeRaw`UPDATE "withdrawals" SET "currency" = 'BDT' WHERE "currency" IS DISTINCT FROM 'BDT'`;
      await tx.$executeRaw`UPDATE "referral_rewards" SET "currency" = 'BDT' WHERE "currency" IS DISTINCT FROM 'BDT'`;
      await tx.$executeRaw`UPDATE "bonuses" SET "currency" = 'BDT' WHERE "currency" IS DISTINCT FROM 'BDT'`;

      await tx.$executeRaw`
        UPDATE "bonus_rules"
        SET "config" = jsonb_set("config"::jsonb, '{currency}', to_jsonb('BDT'::text), true)
        WHERE jsonb_typeof("config"::jsonb) = 'object'
          AND ("config"::jsonb ? 'currency')
          AND ("config"::jsonb ->> 'currency') IS DISTINCT FROM 'BDT'
      `;
      await tx.$executeRaw`
        UPDATE "system_settings"
        SET "value" = jsonb_set("value"::jsonb, '{currency}', to_jsonb('BDT'::text), true)
        WHERE jsonb_typeof("value"::jsonb) = 'object'
          AND ("value"::jsonb ? 'currency')
          AND ("value"::jsonb ->> 'currency') IS DISTINCT FROM 'BDT'
      `;

      await tx.systemSetting.create({
        data: {
          key: migrationKey,
          value: { currency: 'BDT', numericAmountsChanged: false },
        },
      });
    });

    this.logger.log('Existing wallet, ledger, payment and bonus currency labels normalized to BDT');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Database disconnected');
  }
}
