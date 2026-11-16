import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DepositStatus } from '@prisma/client';
import type { Request } from 'express';
import { AdminRoleGuard } from '../../auth/guards/admin-role.guard';
import { DepositService } from '../deposit.service';

interface RequestWithUser extends Request {
  user: { userId: string; role: string };
}

const STATUSES = Object.values(DepositStatus);

@ApiTags('Admin – Deposits')
@ApiBearerAuth()
@UseGuards(AdminRoleGuard)
@Controller('admin/payment/deposits')
export class BdGatewayAdminDepositsController {
  constructor(private readonly deposits: DepositService) {}

  @Get()
  async list(
    @Query('status') status?: string,
    @Query('skip') skip = '0',
    @Query('take') take = '50',
  ) {
    if (status && !STATUSES.includes(status as DepositStatus)) {
      throw new BadRequestException('Invalid deposit status');
    }
    const pageSkip = Math.max(0, Number(skip) || 0);
    const pageTake = Math.min(100, Math.max(1, Number(take) || 50));
    return this.deposits.getAdminDepositQueue(status as DepositStatus | undefined, pageSkip, pageTake);
  }

  @Post(':depositId/reconcile')
  reconcile(@Param('depositId') depositId: string, @Req() _request: RequestWithUser) {
    return this.deposits.reconcileBdGatewayDepositAsAdmin(depositId);
  }
}
