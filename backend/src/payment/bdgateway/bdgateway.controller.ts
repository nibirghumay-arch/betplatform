import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  RawBodyRequest,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Public } from '../../auth/decorators/public.decorator';
import { DepositService } from '../deposit.service';
import { BdGatewayService } from './bdgateway.service';
import { BdGatewayWebhookPayload } from './bdgateway.types';

/**
 * Inbound half of the BD Payment Gateway integration.
 *
 * The gateway signs every delivery with the merchant webhook secret
 * (`X-Gateway-Signature: t=<unix>,v1=<hmac-sha256 of "<t>.<rawBody>">`), so a
 * bad signature is rejected outright. A good signature still only tells us
 * *something* changed — DepositService re-reads the order from the gateway API
 * before any wallet is credited.
 */
@ApiTags('Payment – Deposits')
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
    // Sign over the exact bytes received. Falling back to a re-serialised body
    // would only work by luck, so treat a missing rawBody as unverifiable.
    const rawBody = req.rawBody;
    if (!rawBody) {
      throw new UnauthorizedException('Raw body unavailable — cannot verify signature');
    }

    if (!this.bdGateway.verifyWebhookSignature(signature, rawBody)) {
      this.logger.warn('Rejected BD gateway webhook: invalid or expired signature');
      // 401 (not 200) so the gateway keeps the delivery in its retry queue.
      throw new UnauthorizedException('Invalid webhook signature');
    }

    let payload: BdGatewayWebhookPayload;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      this.logger.error('BD gateway webhook body was not valid JSON');
      return { received: true };
    }

    await this.depositService.handleBdGatewayWebhook(payload);
    return { received: true };
  }

  /**
   * Re-checks one deposit against the gateway and settles it if the gateway
   * says APPROVED. Lets the wallet page resolve itself when a webhook is late
   * or was lost. Only ever credits the deposit's own owner, so it cannot be
   * used to move money between accounts.
   */
  @Post(':depositId/reconcile')
  @HttpCode(HttpStatus.OK)
  reconcile(@Param('depositId') depositId: string) {
    return this.depositService.reconcileBdGatewayDeposit(depositId);
  }
}
