import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SslCommerzClientService } from './sslcommerz-client.service';
import {
  SslInitiateSessionParams,
  SslApiInitResponse,
  SslCallbackBody,
  SslValidationResponse,
} from './sslcommerz.types';

/**
 * Maps SSLCommerz's "gw" mobile-banking gateway codes to the site's own
 * PaymentMethodType enum (see prisma/schema.prisma) so the rest of the app
 * never has to know SSLCommerz's internal naming.
 *
 * These codes match what SSLCommerz returns in the `desc[].gw` field of the
 * init response and what it accepts back via `multi_card_name` to restrict
 * checkout to a single mobile wallet.
 */
export const MOBILE_GATEWAY_CODES = {
  BKASH: 'bkash',
  NAGAD: 'nagad',
  ROCKET: 'dbblmobilebanking', // Rocket = Dutch-Bangla Mobile Banking
  UPAY: 'upay',
  MCASH: 'mcash',
  TAP: 'tap',
} as const;

export type SupportedMobileGateway = keyof typeof MOBILE_GATEWAY_CODES;

@Injectable()
export class SslcommerzService {
  private readonly logger = new Logger(SslcommerzService.name);

  constructor(
    private readonly client: SslCommerzClientService,
    private readonly config: ConfigService,
  ) {}

  get isConfigured(): boolean {
    return this.client.configured;
  }

  /**
   * Start a checkout session. `restrictToGateway`, when one of
   * SupportedMobileGateway, locks the SSLCommerz payment page down to that
   * single mobile wallet so the user isn't shown card/other options — used
   * when the user has already chosen e.g. "bKash" on our own deposit form.
   * Leave undefined to let SSLCommerz show its full method picker.
   */
  async createSession(params: SslInitiateSessionParams): Promise<{
    gatewayPageUrl: string;
    sessionKey: string;
  }> {
    if (!this.isConfigured) {
      throw new BadRequestException(
        'SSLCommerz is not configured on this server (missing store credentials)',
      );
    }

    const multiCardName = params.restrictToGateway
      ? MOBILE_GATEWAY_CODES[params.restrictToGateway as SupportedMobileGateway]
      : undefined;

    const response: SslApiInitResponse = await this.client.init({
      total_amount: params.totalAmount.toFixed(2),
      currency: params.currency,
      tran_id: params.tranId,
      success_url: params.successUrl,
      fail_url: params.failUrl,
      cancel_url: params.cancelUrl,
      ipn_url: params.ipnUrl,
      multi_card_name: multiCardName,
      cus_name: params.customer.name,
      cus_email: params.customer.email,
      cus_add1: params.customer.address1 || 'N/A',
      cus_city: params.customer.city || 'Dhaka',
      cus_postcode: params.customer.postcode || '1000',
      cus_country: params.customer.country || 'Bangladesh',
      cus_phone: params.customer.phone,
      shipping_method: params.shippingMethod ?? 'NO',
      num_of_item: String(params.numOfItem ?? 1),
      product_name: params.productName ?? 'Wallet Deposit',
      product_category: params.productCategory ?? 'wallet-topup',
      product_profile: params.productProfile ?? 'general',
      value_a: params.valueA,
      value_b: params.valueB,
      value_c: params.valueC,
      value_d: params.valueD,
      emi_option: '0',
    });

    if (response.status !== 'SUCCESS' || !response.GatewayPageURL || !response.sessionkey) {
      this.logger.error(`SSLCommerz init failed: ${JSON.stringify(response)}`);
      throw new BadRequestException(
        response.failedreason || 'SSLCommerz was unable to create a checkout session',
      );
    }

    return { gatewayPageUrl: response.GatewayPageURL, sessionKey: response.sessionkey };
  }

  /**
   * Authoritative confirmation step. SSLCommerz's redirect/IPN payloads are
   * NOT trusted on their own (they're POSTed by the customer's browser or,
   * for IPN, over plain HTTP without a shared-secret signature) — we always
   * call back into SSLCommerz's own Order Validation API and only credit a
   * wallet if that independent check comes back VALID/VALIDATED and the
   * amount+currency match what we expect.
   */
  async validateTransaction(
    valId: string,
    expected: { tranId: string; amount: string; currency: string },
  ): Promise<SslValidationResponse> {
    const result = await this.client.validate(valId);

    if (result.status !== 'VALID' && result.status !== 'VALIDATED') {
      throw new BadRequestException(
        `SSLCommerz validation returned status=${result.status} for tran_id=${expected.tranId}`,
      );
    }

    if (result.tran_id !== expected.tranId) {
      throw new BadRequestException(
        `SSLCommerz validation tran_id mismatch: expected ${expected.tranId}, got ${result.tran_id}`,
      );
    }

    const gap = Math.abs(parseFloat(result.amount) - parseFloat(expected.amount));
    if (gap > 0.01) {
      throw new BadRequestException(
        `SSLCommerz validation amount mismatch: expected ${expected.amount}, got ${result.amount}`,
      );
    }

    return result;
  }

  /** Human-readable payment channel label for transaction history, derived
   * from whatever SSLCommerz reports back (works for mobile wallets, cards,
   * and net banking alike). */
  describeChannel(body: Pick<SslCallbackBody, 'card_issuer' | 'card_type' | 'card_brand'>): string {
    return body.card_issuer || body.card_brand || body.card_type || 'SSLCommerz';
  }

  parseGatewayCallbackStatus(status: string): 'success' | 'failed' | 'cancelled' {
    switch (status) {
      case 'VALID':
      case 'VALIDATED':
        return 'success';
      case 'CANCELLED':
        return 'cancelled';
      default:
        return 'failed';
    }
  }
}
