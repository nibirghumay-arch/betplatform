import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  Headers,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { RawBodyRequest } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { WithdrawalStatus } from '@prisma/client';
import { Request } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { WithdrawalService } from './withdrawal.service';
import {
  RequestWithdrawalDto,
  ApproveWithdrawalDto,
  RejectWithdrawalDto,
  CancelWithdrawalDto,
  PaginationQueryDto,
} from './dto/payment.dto';

@ApiTags('Payment – Withdrawals')
@ApiBearerAuth()
@Controller('payment/withdrawal')
export class WithdrawalController {
  constructor(private readonly withdrawalService: WithdrawalService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  request(@Body() dto: RequestWithdrawalDto) {
    return this.withdrawalService.request({
      userId: dto.userId,
      amount: dto.amount,
      currency: dto.currency,
      pspProvider: dto.pspProvider,
      payoutDetails: dto.payoutDetails,
      paymentMethodId: dto.paymentMethodId,
      metadata: dto.metadata,
    });
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@Param('id') id: string, @Body() dto: CancelWithdrawalDto) {
    return this.withdrawalService.cancel(id, dto.userId);
  }

  /**
   * PSP-to-server webhook confirming payout settled.
   * The ledger debit is recorded here — not on approval.
   * Public: called by the PSP's servers, never by a logged-in user, so it
   * must bypass the global JwtAuthGuard.
   */
  @Public()
  @Post('webhook/:provider')
  @HttpCode(HttpStatus.OK)
  async webhook(
    @Param('provider') provider: string,
    @Headers('stripe-signature') stripeSignature: string,
    @Headers('x-webhook-signature') genericSignature: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    const signature = stripeSignature || genericSignature || '';
    const rawBody: Buffer = req.rawBody ?? Buffer.from(JSON.stringify(req.body));
    await this.withdrawalService.handleWebhook(provider, signature, rawBody);
    return { received: true };
  }

  @Get()
  list(
    @Query('userId') userId: string,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.withdrawalService.listByUser(userId, pagination.skip, pagination.take);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.withdrawalService.findById(id);
  }
}

// ─── Admin endpoints (separate controller prefix) ─────────────────────────────

@ApiTags('Admin – Withdrawals')
@ApiBearerAuth()
@Controller('admin/withdrawal')
export class WithdrawalAdminController {
  constructor(private readonly withdrawalService: WithdrawalService) {}

  @Get('queue')
  getQueue(
    @Query('status') status?: string,
    @Query() pagination?: PaginationQueryDto,
  ) {
    return this.withdrawalService.getAdminQueue(
      (status as WithdrawalStatus | undefined) ?? WithdrawalStatus.PENDING_REVIEW,
      pagination?.skip,
      pagination?.take,
    );
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  approve(@Param('id') id: string, @Body() dto: ApproveWithdrawalDto) {
    return this.withdrawalService.approve(id, dto.adminId);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  reject(@Param('id') id: string, @Body() dto: RejectWithdrawalDto) {
    return this.withdrawalService.reject(id, dto.adminId, dto.reason);
  }
}
