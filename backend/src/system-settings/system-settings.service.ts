import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SystemSettingsService {
  private readonly logger = new Logger(SystemSettingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async get<T = unknown>(key: string, defaultValue?: T): Promise<T> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key } });
    if (row === null) {
      if (defaultValue !== undefined) return defaultValue;
      throw new Error(`System setting '${key}' not found and no default provided`);
    }
    return row.value as T;
  }

  async getNumber(key: string, defaultValue: number): Promise<number> {
    const val = await this.get<number>(key, defaultValue);
    return Number(val);
  }

  async getString(key: string, defaultValue: string): Promise<string> {
    return this.get<string>(key, defaultValue);
  }

  async set(key: string, value: unknown, updatedBy?: string): Promise<void> {
    await this.prisma.systemSetting.upsert({
      where: { key },
      update: { value: value as any, updatedBy },
      create: { key, value: value as any, updatedBy },
    });
    this.logger.log(`Setting updated: key=${key} by=${updatedBy ?? 'system'}`);
  }

  async getAll(): Promise<Record<string, unknown>> {
    const rows = await this.prisma.systemSetting.findMany();
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }
}
