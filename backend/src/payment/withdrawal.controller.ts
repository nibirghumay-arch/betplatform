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
  NotFoundException,
  Req,
  UseGuards,
} from '@nestjs/common';
import { RawBodyRequest } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { WithdrawalStatus } from '@prisma/client';
import { Request } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { AdminRoleGuard } from '../auth/guards/admin-role.guard';
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
interface RequestWithUser extends Request { user: { userId: string; role: string } };

@Controller('payment/withdrawal')
export class WithdrawalController {
  constructor(private readonly withdrawalService: WithdrawalService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  request(@Body() dto: RequestWithdrawalDto, @Req() request: RequestWithUser) {
    return this.withdrawalService.request({
      userId: request.user.userId,
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
  cancel(@Param('id') id: string, @Req() request: RequestWithUser) {
    return this.withdrawalService.cancel(id, request.user.userId);
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
  list(@Query() pagination: PaginationQueryDto, @Req() request: RequestWithUser) {
    return this.withdrawalService.listByUser(request.user.userId, pagination.skip, pagination.take);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Req() request: RequestWithUser) {
    const withdrawal = await this.withdrawalService.findById(id);
    if (withdrawal.userId !== request.user.userId) {
      throw new NotFoundException(`Withdrawal ${id} not found`);
    }
    return withdrawal;
  }
}

// ─── Admin endpoints (separate controller prefix) ─────────────────────────────

@ApiTags('Admin – Withdrawals')
@ApiBearerAuth()
@Controller('admin/withdrawal')
@UseGuards(AdminRoleGuard)
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
  approve(@Param('id') id: string, @Req() request: RequestWithUser) {
    return this.withdrawalService.approve(id, request.user.userId);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  reject(
    @Param('id') id: string,
    @Body() dto: RejectWithdrawalDto,
    @Req() request: RequestWithUser,
  ) {
    return this.withdrawalService.reject(id, request.user.userId, dto.reason);
  }
}
