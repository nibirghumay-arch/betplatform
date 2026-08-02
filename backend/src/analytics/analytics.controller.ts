import { Controller, Get, Post, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';

@ApiTags('Admin – Analytics')
@ApiBearerAuth()
@Controller('admin/analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('dashboard')
  getDashboard() {
    return this.analytics.getDashboardStats();
  }

  @Get('segments')
  getSegments() {
    return this.analytics.getSegments();
  }

  @Get('snapshots')
  getSnapshots(@Query('days') days?: string) {
    return this.analytics.getSnapshotHistory(days ? Number(days) : 30);
  }

  @Post('snapshot')
  takeSnapshot() {
    return this.analytics.takeSnapshot();
  }
}
