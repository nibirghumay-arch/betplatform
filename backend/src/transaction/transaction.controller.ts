import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { TransactionType } from '@prisma/client';
import { TransactionService } from './transaction.service';
import { DepositDto, WithdrawDto, ManualAdjustmentDto } from './dto/transaction.dto';

@ApiTags('Transactions')
@ApiBearerAuth()
@Controller('transactions')
export class TransactionController {
  constructor(private readonly transactionService: TransactionService) {}

  @Post('deposit')
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
  @HttpCode(HttpStatus.CREATED)
  manualCredit(@Body() dto: ManualAdjustmentDto) {
    return this.transactionService.manualCredit({
      userId: dto.userId,
      adminId: dto.adminId,
      amount: dto.amount,
      description: dto.description,
      reference: dto.reference,
      metadata: dto.metadata,
    });
  }

  @Post('manual-debit')
  @HttpCode(HttpStatus.CREATED)
  manualDebit(@Body() dto: ManualAdjustmentDto) {
    return this.transactionService.manualDebit({
      userId: dto.userId,
      adminId: dto.adminId,
      amount: dto.amount,
      description: dto.description,
      reference: dto.reference,
      metadata: dto.metadata,
    });
  }

  @Get(':id')
  getTransaction(@Param('id') id: string) {
    return this.transactionService.getTransaction(id);
  }

  @Get('reference/:ref')
  getByReference(@Param('ref') ref: string) {
    return this.transactionService.getTransactionByReference(ref);
  }

  @Get()
  getHistory(
    @Query('userId') userId: string,
    @Query('type') type?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    return this.transactionService.getTransactionHistory({
      userId,
      type: type as TransactionType | undefined,
      skip: skip ? parseInt(skip, 10) : undefined,
      take: take ? parseInt(take, 10) : undefined,
    });
  }
}
