import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  Headers,
  Req,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { RawBodyRequest } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiExcludeEndpoint } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { DepositService } from './deposit.service';
import { SslcommerzService } from './sslcommerz/sslcommerz.service';
import { SslCallbackBody } from './sslcommerz/sslcommerz.types';
import { SslCommerzCallbackDto } from './dto/sslcommerz-callback.dto';
import { InitiateDepositDto, DepositListQueryDto } from './dto/payment.dto';

@ApiTags('Payment – Deposits')
@ApiBearerAuth()
@Controller('payment/deposit')
export class DepositController {
  constructor(
    private readonly depositService: DepositService,
    private readonly sslcommerz: SslcommerzService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Frontend calls this to start a deposit.
   * Returns a PSP checkout URL — the user is redirected there to pay.
   * Never trust the frontend to confirm payment: that comes from the PSP webhook
   * (or, for SSLCommerz, the success/IPN endpoints below).
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  initiate(@Body() dto: InitiateDepositDto) {
    return this.depositService.initiate({
      userId: dto.userId,
      amount: dto.amount,
      currency: dto.currency,
      pspProvider: dto.pspProvider,
      metadata: dto.metadata,
      mobileGateway: dto.mobileGateway,
      customer: dto.customer,
    });
  }

  /**
   * PSP-to-server webhook (Stripe/PayPal-style: JSON body + HMAC signature).
   * The raw body MUST be preserved for signature verification — JSON parsing
   * is handled inside the service, not by NestJS middleware.
   * Always returns 200 so the PSP does not retry unnecessarily on our errors.
   * Public: this is called by the PSP's servers, never by a logged-in user.
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
    await this.depositService.handleWebhook(provider, signature, rawBody);
    return { received: true };
  }

  // ─── SSLCommerz callbacks ────────────────────────────────────────────────
  //
  // SSLCommerz does NOT sign these with a shared secret — it posts
  // application/x-www-form-urlencoded data to success_url/fail_url/cancel_url
  // via the customer's browser (redirect), and separately to ipn_url
  // server-to-server. Both are treated as untrusted hints: we always call
  // back into SSLCommerz's own Order Validation API before crediting a
  // wallet (see SslcommerzService.validateTransaction). All four routes are
  // @Public() since SSLCommerz/the customer's browser has no JWT.

  @Public()
  @ApiExcludeEndpoint()
  @Post('sslcommerz/success')
  @HttpCode(HttpStatus.OK)
  async sslcommerzSuccess(@Body() body: SslCommerzCallbackDto, @Res() res: Response) {
    await this.handleSslcommerzRedirect(body, res, 'success');
  }

  @Public()
  @ApiExcludeEndpoint()
  @Post('sslcommerz/fail')
  @HttpCode(HttpStatus.OK)
  async sslcommerzFail(@Body() body: SslCommerzCallbackDto, @Res() res: Response) {
    await this.handleSslcommerzRedirect(body, res, 'fail');
  }

  @Public()
  @ApiExcludeEndpoint()
  @Post('sslcommerz/cancel')
  @HttpCode(HttpStatus.OK)
  async sslcommerzCancel(@Body() body: SslCommerzCallbackDto, @Res() res: Response) {
    await this.handleSslcommerzRedirect(body, res, 'cancel');
  }

  /**
   * Server-to-server IPN — SSLCommerz calls this independently of whether
   * the customer's browser ever makes it back to success_url. This is the
   * authoritative confirmation path in production (browser redirects can be
   * lost to closed tabs, flaky connections, etc.), so it performs the same
   * validate-then-settle flow but responds with JSON, not a redirect.
   */
  @Public()
  @ApiExcludeEndpoint()
  @Post('sslcommerz/ipn')
  @HttpCode(HttpStatus.OK)
  async sslcommerzIpn(@Body() body: SslCommerzCallbackDto) {
    await this.settleOrFailSslcommerz(body);
    return { received: true };
  }

  private async handleSslcommerzRedirect(
    body: SslCallbackBody,
    res: Response,
    outcome: 'success' | 'fail' | 'cancel',
  ): Promise<void> {
    const frontendUrl = this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3001';
    const depositId = body.value_a || body.tran_id;

    try {
      if (outcome === 'success') {
        await this.settleOrFailSslcommerz(body);
        res.redirect(`${frontendUrl}/wallet/deposit/result?status=success&depositId=${depositId}`);
        return;
      }
      if (outcome === 'cancel') {
        await this.depositService.markSslcommerzFailed(body, 'Cancelled by user at SSLCommerz');
        res.redirect(`${frontendUrl}/wallet/deposit/result?status=cancelled&depositId=${depositId}`);
        return;
      }
      await this.depositService.markSslcommerzFailed(body, body.error || 'SSLCommerz payment failed');
      res.redirect(`${frontendUrl}/wallet/deposit/result?status=failed&depositId=${depositId}`);
    } catch (err) {
      res.redirect(
        `${frontendUrl}/wallet/deposit/result?status=failed&depositId=${depositId}&reason=${encodeURIComponent((err as Error).message)}`,
      );
    }
  }

  private async settleOrFailSslcommerz(body: SslCallbackBody): Promise<void> {
    if (!body.val_id) {
      await this.depositService.markSslcommerzFailed(body, 'Missing val_id in SSLCommerz callback');
      return;
    }

    try {
      await this.sslcommerz.validateTransaction(body.val_id, {
        tranId: body.tran_id,
        amount: body.amount ?? '0',
        currency: body.currency ?? 'BDT',
      });
      await this.depositService.settleSslcommerzTransaction(body);
    } catch (err) {
      await this.depositService.markSslcommerzFailed(body, (err as Error).message);
      throw err;
    }
  }

  @Get()
  list(@Query() query: DepositListQueryDto) {
    return this.depositService.listByUser(query.userId ?? '', query.skip, query.take);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.depositService.findById(id);
  }
}
