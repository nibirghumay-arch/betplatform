import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ReportType } from '@prisma/client';
import { ReportingService, ReportParams } from './reporting.service';

@ApiTags('Admin – Reports')
@ApiBearerAuth()
@Controller('admin/reports')
export class ReportingController {
  constructor(private readonly reporting: ReportingService) {}

  @Post()
  queueReport(
    @Body() body: { type: ReportType; params: ReportParams; requestedBy: string },
  ) {
    return this.reporting.queueReport(body.type, body.params, body.requestedBy);
  }

  @Get(':id')
  getJob(@Param('id') id: string) {
    return this.reporting.getJob(id);
  }

  @Get()
  listJobs(@Query('requestedBy') requestedBy: string) {
    return this.reporting.listJobs(requestedBy);
  }

  @Get('revenue/inline')
  getRevenue(@Query('from') from: string, @Query('to') to: string, @Query('groupBy') groupBy?: 'day' | 'month') {
    return this.reporting.getRevenueReport(new Date(from), new Date(to), groupBy);
  }

  @Get('player/inline')
  getPlayer(@Query('from') from: string, @Query('to') to: string) {
    return this.reporting.getPlayerReport(new Date(from), new Date(to));
  }

  @Get('game/inline')
  getGame(@Query('from') from: string, @Query('to') to: string, @Query('gameId') gameId?: string) {
    return this.reporting.getGameReport(new Date(from), new Date(to), gameId);
  }
}
