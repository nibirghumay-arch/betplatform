import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Req,
  RawBodyRequest,
  UnauthorizedException,
  Body,
} from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { IsOptional, IsString, Matches } from 'class-validator';
import { Public } from '../../auth/decorators/public.decorator';
import { DepositService } from '../deposit.service';
import { BdGatewayService } from './bdgateway.service';
import { BdGatewayWebhookPayload } from './bdgateway.types';

interface RequestWithUser extends Request {
  user: { userId: string; role: string };
}

class SubmitBdGatewayTrxDto {
  @IsString()
  @Matches(/^[A-Za-z0-9]{6,20}$/)
  trxId!: string;

  @IsOptional()
  @IsString()
  @Matches(/^01[3-9]\d{8}$/)
  customerMsisdn?: string;
}

@ApiTags('Payment – BD Gateway')
@ApiBearerAuth()
@Controller('payment/deposit/bdgateway')
export class BdGatewayController {
  private readonly logger = new Logger(BdGatewayController.name);

  constructor(
    private readonly depositService: DepositService,
    private readonly bdGateway: BdGatewayService,
  ) {}

  @Public()
  @ApiExcludeEndpoint()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async webhook(
    @Headers('x-gateway-signature') signature: string,
    @Req() req: RawBodyRequest<Request>,
  ): Promise<{ received: boolean }> {
    const rawBody = req.rawBody;
    if (!rawBody) {
      throw new UnauthorizedException('Raw body unavailable — cannot verify signature');
    }
    if (!(await this.bdGateway.verifyWebhookSignature(signature, rawBody))) {
      this.logger.warn('Rejected BD gateway webhook: invalid or expired signature');
      throw new UnauthorizedException('Invalid webhook signature');
    }
    let payload: BdGatewayWebhookPayload;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      this.logger.error('BD gateway webhook body was not valid JSON');
      throw new UnauthorizedException('Invalid webhook body');
    }
    await this.depositService.handleBdGatewayWebhook(payload);
    return { received: true };
  }

  @Post(':depositId/submit-trx')
  @HttpCode(HttpStatus.OK)
  submitTrx(
    @Param('depositId') depositId: string,
    @Body() dto: SubmitBdGatewayTrxDto,
    @Req() request: RequestWithUser,
  ) {
    return this.depositService.submitBdGatewayTrx(
      depositId,
      request.user.userId,
      dto.trxId,
      dto.customerMsisdn,
    );
  }

  @Post(':depositId/reconcile')
  @HttpCode(HttpStatus.OK)
  reconcile(@Param('depositId') depositId: string, @Req() request: RequestWithUser) {
    return this.depositService.reconcileBdGatewayDeposit(depositId, request.user.userId);
  }
}
