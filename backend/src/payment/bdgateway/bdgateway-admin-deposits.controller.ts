import {
  Body,
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
import { IsOptional, IsString, Length, MaxLength } from 'class-validator';
import type { Request } from 'express';
import { AdminRoleGuard } from '../../auth/guards/admin-role.guard';
import { DepositService } from '../deposit.service';

interface RequestWithUser extends Request {
  user: { userId: string; role: string };
}

class CheckDepositTrxDto {
  @IsString()
  @Length(6, 20)
  smsTrxId!: string;
}

class RejectDepositDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
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

  @Post(':depositId/check-trx')
  checkTrx(
    @Param('depositId') depositId: string,
    @Body() dto: CheckDepositTrxDto,
    @Req() request: RequestWithUser,
  ) {
    return this.deposits.checkBdGatewayDepositTrxAsAdmin(
      depositId,
      dto.smsTrxId,
      request.user.userId,
    );
  }

  @Post(':depositId/approve')
  approve(
    @Param('depositId') depositId: string,
    @Req() request: RequestWithUser,
  ) {
    return this.deposits.approveBdGatewayDepositAsAdmin(depositId, request.user.userId);
  }

  @Post(':depositId/reject')
  reject(
    @Param('depositId') depositId: string,
    @Body() dto: RejectDepositDto,
    @Req() request: RequestWithUser,
  ) {
    return this.deposits.rejectBdGatewayDepositAsAdmin(
      depositId,
      dto.reason ?? 'Rejected by administrator',
      request.user.userId,
    );
  }

  @Post(':depositId/reconcile')
  reconcile(@Param('depositId') depositId: string, @Req() _request: RequestWithUser) {
    return this.deposits.reconcileBdGatewayDepositAsAdmin(depositId);
  }
}
