import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { TransactionType } from '@prisma/client';
import type { Request } from 'express';
import { AdminRoleGuard } from '../auth/guards/admin-role.guard';
import { TransactionService } from './transaction.service';
import { DepositDto, WithdrawDto, ManualAdjustmentDto } from './dto/transaction.dto';

interface RequestWithUser extends Request {
  user: { userId: string; role: string };
}

@ApiTags('Transactions')
@ApiBearerAuth()
@Controller('transactions')
export class TransactionController {
  constructor(private readonly transactionService: TransactionService) {}

  // Direct ledger settlement endpoints are administrator-only. Customer
  // deposits must use /payment/deposit and be confirmed by the PSP/gateway.
  @Post('deposit')
  @UseGuards(AdminRoleGuard)
  @HttpCode(HttpStatus.CREATED)
  deposit(@Body() dto: DepositDto) {
    return this.transactionService.deposit({
      userId: dto.userId,
      amount: dto.amount,
      reference: dto.reference,
      description: dto.description,
      metadata: dto.metadata,
    });
  }

  @Post('withdraw')
  @UseGuards(AdminRoleGuard)
  @HttpCode(HttpStatus.CREATED)
  withdraw(@Body() dto: WithdrawDto) {
    return this.transactionService.withdraw({
      userId: dto.userId,
      amount: dto.amount,
      reference: dto.reference,
      description: dto.description,
    });
  }

  @Post('manual-credit')
  @UseGuards(AdminRoleGuard)
  @HttpCode(HttpStatus.CREATED)
  manualCredit(@Body() dto: ManualAdjustmentDto, @Req() request: RequestWithUser) {
    return this.transactionService.manualCredit({
      userId: dto.userId,
      adminId: request.user.userId,
      amount: dto.amount,
      description: dto.description,
      reference: dto.reference,
      metadata: dto.metadata,
    });
  }

  @Post('manual-debit')
  @UseGuards(AdminRoleGuard)
  @HttpCode(HttpStatus.CREATED)
  manualDebit(@Body() dto: ManualAdjustmentDto, @Req() request: RequestWithUser) {
    return this.transactionService.manualDebit({
      userId: dto.userId,
      adminId: request.user.userId,
      amount: dto.amount,
      description: dto.description,
      reference: dto.reference,
      metadata: dto.metadata,
    });
  }

  @Get(':id')
  @UseGuards(AdminRoleGuard)
  getTransaction(@Param('id') id: string) {
    return this.transactionService.getTransaction(id);
  }

  @Get('reference/:ref')
  @UseGuards(AdminRoleGuard)
  getByReference(@Param('ref') ref: string) {
    return this.transactionService.getTransactionByReference(ref);
  }

  @Get()
  getHistory(
    @Query('type') type: string | undefined,
    @Query('skip') skip: string | undefined,
    @Query('take') take: string | undefined,
    @Req() request: RequestWithUser,
  ) {
    return this.transactionService.getTransactionHistory({
      userId: request.user.userId,
      type: type as TransactionType | undefined,
      skip: skip ? parseInt(skip, 10) : undefined,
      take: take ? parseInt(take, 10) : undefined,
    });
  }
}
