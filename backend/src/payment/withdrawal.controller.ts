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
  RejectWithdrawalDto,
  PaginationQueryDto,
} from './dto/payment.dto';

interface RequestWithUser extends Request {
  user: { userId: string; email: string; role: string };
}

@ApiTags('Payment – Withdrawals')
@ApiBearerAuth()
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

@ApiTags('Admin – Withdrawals')
@ApiBearerAuth()
@UseGuards(AdminRoleGuard)
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
