import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Unauthenticated liveness probe. Exists mainly so a fresh Netlify deploy can
 * be verified with a single GET — a cold start that cannot reach the database
 * reports `database: "down"` here instead of failing every real request with an
 * opaque 500.
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness and database connectivity check' })
  async check(): Promise<{
    status: 'ok' | 'degraded';
    database: 'up' | 'down';
    runtime: 'netlify' | 'node';
    timestamp: string;
  }> {
    let database: 'up' | 'down' = 'down';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database = 'up';
    } catch {
      // Swallowed on purpose: the point of this endpoint is to report the
      // failure as data, not to throw.
    }

    return {
      status: database === 'up' ? 'ok' : 'degraded',
      database,
      runtime: process.env.NETLIFY === 'true' ? 'netlify' : 'node',
      timestamp: new Date().toISOString(),
    };
  }
}
