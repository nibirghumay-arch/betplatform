import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { BdGatewayConfigService } from './bdgateway-config.service';
import {
  BdGatewayCreateOrderParams,
  BdGatewayOrder,
  BdGatewayOrderDetail,
  BdGatewayProvider,
} from './bdgateway.types';

@Injectable()
export class BdGatewayService {
  private readonly logger = new Logger(BdGatewayService.name);
  static readonly SIGNATURE_TOLERANCE_SECONDS = 300;

  constructor(
    private readonly gatewayConfig: BdGatewayConfigService,
    private readonly config: ConfigService,
  ) {}

  async getPublicOptions() {
    return this.gatewayConfig.getPublicOptions();
  }

  async assertAvailable(amountBdt: number, provider: BdGatewayProvider) {
    const runtime = await this.gatewayConfig.getRuntimeConfig();
    if (!runtime.enabled || !runtime.configured) {
      throw new ServiceUnavailableException('This payment method is currently unavailable');
    }
    if (!runtime.providers.includes(provider)) {
      throw new BadRequestException('This payment provider is not currently enabled');
    }
    if (!Number.isFinite(amountBdt) ||
      amountBdt < runtime.minDepositBdt ||
      amountBdt > runtime.maxDepositBdt) {
      throw new BadRequestException(
        `Deposit amount must be between BDT ${runtime.minDepositBdt} and BDT ${runtime.maxDepositBdt}`,
      );
    }
  }

  async createOrder(params: BdGatewayCreateOrderParams): Promise<BdGatewayOrder> {
    await this.assertAvailable(params.amountBdt, params.provider);
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

  async getOrder(reference: string): Promise<BdGatewayOrderDetail | null> {
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

  async verifyWebhookSignature(header: string | undefined, rawBody: Buffer | string): Promise<boolean> {
    const runtime = await this.gatewayConfig.getRuntimeConfig();
    if (!runtime.enabled || !runtime.webhookSecret || !header) return false;

    const parts = new Map<string, string>();
    for (const kv of header.split(',')) {
      const [key, value] = kv.trim().split('=');
      if (key && value) parts.set(key, value);
    }

    const timestamp = Number(parts.get('t'));
    const supplied = parts.get('v1');
    if (!timestamp || !supplied ||
      Math.abs(Date.now() / 1000 - timestamp) > BdGatewayService.SIGNATURE_TOLERANCE_SECONDS) {
      return false;
    }
    if (!/^[a-fA-F0-9]{64}$/.test(supplied)) return false;

    const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    const expected = createHmac('sha256', runtime.webhookSecret)
      .update(`${timestamp}.${body}`)
      .digest();
    const given = Buffer.from(supplied, 'hex');
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const runtime = await this.gatewayConfig.getRuntimeConfig();
    if (!runtime.enabled || !runtime.configured) {
      throw new BadRequestException('The BD payment gateway is not enabled on this site');
    }

    const timeoutMs = Number(this.config.get<string>('BD_GATEWAY_TIMEOUT_MS') ?? 10000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${runtime.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${runtime.apiKey}:${runtime.apiSecret}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        cache: 'no-store',
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
      if (err instanceof BadRequestException || err instanceof ServiceUnavailableException) throw err;
      this.logger.error(`Gateway request failed: ${(err as Error).message}`);
      throw new ServiceUnavailableException('Could not reach the payment gateway');
    } finally {
      clearTimeout(timer);
    }
  }
}
