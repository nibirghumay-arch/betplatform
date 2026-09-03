import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  BdGatewayCreateOrderParams,
  BdGatewayOrder,
  BdGatewayOrderDetail,
} from './bdgateway.types';

/**
 * Client for the self-hosted BD Payment Gateway.
 *
 * Flow: we create an order → the customer is sent to the gateway's checkout
 * page → they Send Money to the displayed bKash/Nagad number and submit the
 * TrxID → the gateway matches it against the SMS forwarded from the owner's
 * phone → it POSTs us a signed `order.approved` webhook.
 *
 * The webhook is only a notification. Before crediting anything we always
 * re-read the order from the gateway API, the same way the SSLCommerz
 * integration re-validates through the Order Validation API.
 */
@Injectable()
export class BdGatewayService {
  private readonly logger = new Logger(BdGatewayService.name);

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly webhookSecret: string;
  private readonly timeoutMs: number;

  /** Replay window for webhook signatures, matching the gateway's default. */
  static readonly SIGNATURE_TOLERANCE_SECONDS = 300;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = (this.config.get<string>('BD_GATEWAY_URL') ?? '').replace(/\/+$/, '');
    this.apiKey = this.config.get<string>('BD_GATEWAY_API_KEY') ?? '';
    this.apiSecret = this.config.get<string>('BD_GATEWAY_API_SECRET') ?? '';
    this.webhookSecret = this.config.get<string>('BD_GATEWAY_WEBHOOK_SECRET') ?? '';
    this.timeoutMs = Number(this.config.get<string>('BD_GATEWAY_TIMEOUT_MS') ?? 10000);

    if (!this.isConfigured) {
      this.logger.warn(
        'BD_GATEWAY_URL / BD_GATEWAY_API_KEY / BD_GATEWAY_API_SECRET not configured — bdgateway deposits will fail until set',
      );
    } else if (!this.canVerifyWebhooks) {
      this.logger.warn(
        'BD_GATEWAY_WEBHOOK_SECRET is not set — incoming gateway webhooks will be rejected',
      );
    }
  }

  get isConfigured(): boolean {
    return Boolean(this.baseUrl && this.apiKey && this.apiSecret);
  }

  get canVerifyWebhooks(): boolean {
    return Boolean(this.webhookSecret);
  }

  // ─── Orders ────────────────────────────────────────────────────────────────

  async createOrder(params: BdGatewayCreateOrderParams): Promise<BdGatewayOrder> {
    this.assertConfigured();

    const order = await this.request<BdGatewayOrder>('POST', '/api/orders', {
      amountBdt: Number(params.amountBdt.toFixed(2)),
      provider: params.provider,
      returnUrl: params.returnUrl,
      metadata: params.metadata,
      expiresInMinutes: params.expiresInMinutes ?? 30,
    });

    if (!order.reference || !order.checkoutUrl) {
      throw new ServiceUnavailableException('Gateway did not return a usable checkout order');
    }
    return order;
  }

  /** Authoritative status read. Returns null when the gateway has no such order. */
  async getOrder(reference: string): Promise<BdGatewayOrderDetail | null> {
    this.assertConfigured();
    try {
      return await this.request<BdGatewayOrderDetail>(
        'GET',
        `/api/orders/${encodeURIComponent(reference)}`,
      );
    } catch (err) {
      if (err instanceof BadRequestException && /HTTP 404/.test(err.message)) return null;
      throw err;
    }
  }

  // ─── Webhook signature ─────────────────────────────────────────────────────

  /**
   * Verifies `X-Gateway-Signature: t=<unix>,v1=<hex>` over `${t}.${rawBody}`.
   * Mirror of the gateway's lib/webhook.ts verifySignature().
   */
  verifyWebhookSignature(header: string | undefined, rawBody: Buffer | string): boolean {
    if (!this.canVerifyWebhooks || !header) return false;

    const parts = new Map<string, string>();
    for (const kv of header.split(',')) {
      const [k, v] = kv.trim().split('=');
      if (k && v) parts.set(k, v);
    }

    const timestamp = Number(parts.get('t'));
    const v1 = parts.get('v1');
    if (!timestamp || !v1) return false;
    if (Math.abs(Date.now() / 1000 - timestamp) > BdGatewayService.SIGNATURE_TOLERANCE_SECONDS) {
      return false;
    }

    const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    const expected = Buffer.from(
      createHmac('sha256', this.webhookSecret).update(`${timestamp}.${body}`).digest('hex'),
      'hex',
    );
    let given: Buffer;
    try {
      given = Buffer.from(v1, 'hex');
    } catch {
      return false;
    }
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  // ─── HTTP ──────────────────────────────────────────────────────────────────

  private assertConfigured(): void {
    if (!this.isConfigured) {
      throw new BadRequestException(
        'The bKash/Nagad gateway is not configured on this server',
      );
    }
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.apiKey}:${this.apiSecret}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });

      const text = await res.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        this.logger.error(`Gateway ${method} ${path} returned non-JSON (HTTP ${res.status})`);
        throw new ServiceUnavailableException('Payment gateway returned an unexpected response');
      }

      if (!res.ok) {
        const message = (parsed as { error?: string }).error ?? text.slice(0, 200);
        this.logger.error(`Gateway ${method} ${path} failed: HTTP ${res.status} ${message}`);
        throw new BadRequestException(`Payment gateway error (HTTP ${res.status}): ${message}`);
      }

      return parsed as T;
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        throw new ServiceUnavailableException('Payment gateway did not respond in time');
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
