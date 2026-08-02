import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SslApiInitPayload,
  SslApiInitResponse,
  SslValidationResponse,
  SslRefundInitiateResponse,
  SslRefundQueryResponse,
} from './sslcommerz.types';

/**
 * Thin, faithful port of the official `sslcommerz-lts` Node SDK
 * (https://www.npmjs.com/package/sslcommerz-lts), rewritten to:
 *  - use the runtime's built-in fetch instead of node-fetch/form-data
 *  - be typed and injectable as a NestJS provider
 *  - read store credentials from ConfigService instead of constructor args
 *
 * The endpoint paths and parameter names are unchanged from SSLCommerz's own
 * v4 API so this behaves identically to the reference implementation:
 * https://developer.sslcommerz.com/doc/v4/
 */
@Injectable()
export class SslCommerzClientService {
  private readonly logger = new Logger(SslCommerzClientService.name);

  private readonly storeId: string;
  private readonly storePasswd: string;
  private readonly isLive: boolean;
  private readonly baseUrl: string;

  private readonly initUrl: string;
  private readonly validationUrl: string;
  private readonly refundUrl: string;
  private readonly refundQueryUrl: string;
  private readonly txnQueryBySessionUrl: string;
  private readonly txnQueryByTranIdUrl: string;

  constructor(private readonly config: ConfigService) {
    this.storeId = this.config.get<string>('SSLCOMMERZ_STORE_ID') ?? '';
    this.storePasswd = this.config.get<string>('SSLCOMMERZ_STORE_PASSWORD') ?? '';
    this.isLive = (this.config.get<string>('SSLCOMMERZ_LIVE') ?? 'false').toLowerCase() === 'true';
    this.baseUrl = `https://${this.isLive ? 'securepay' : 'sandbox'}.sslcommerz.com`;

    this.initUrl = `${this.baseUrl}/gwprocess/v4/api.php`;
    this.validationUrl = `${this.baseUrl}/validator/api/validationserverAPI.php`;
    this.refundUrl = `${this.baseUrl}/validator/api/merchantTransIDvalidationAPI.php`;
    this.refundQueryUrl = `${this.baseUrl}/validator/api/merchantTransIDvalidationAPI.php`;
    this.txnQueryBySessionUrl = `${this.baseUrl}/validator/api/merchantTransIDvalidationAPI.php`;
    this.txnQueryByTranIdUrl = `${this.baseUrl}/validator/api/merchantTransIDvalidationAPI.php`;

    if (!this.storeId || !this.storePasswd) {
      this.logger.warn(
        'SSLCOMMERZ_STORE_ID / SSLCOMMERZ_STORE_PASSWORD not configured — SSLCommerz deposits will fail until set',
      );
    }
  }

  get configured(): boolean {
    return Boolean(this.storeId && this.storePasswd);
  }

  get environment(): 'live' | 'sandbox' {
    return this.isLive ? 'live' : 'sandbox';
  }

  // ─── Init a payment session ─────────────────────────────────────────────────

  async init(payload: Omit<SslApiInitPayload, 'store_id' | 'store_passwd'>): Promise<SslApiInitResponse> {
    const body = new URLSearchParams({
      ...payload,
      store_id: this.storeId,
      store_passwd: this.storePasswd,
    } as Record<string, string>);

    return this.post<SslApiInitResponse>(this.initUrl, body);
  }

  // ─── Validate a transaction after redirect/IPN ──────────────────────────────

  async validate(valId: string): Promise<SslValidationResponse> {
    const qs = new URLSearchParams({
      val_id: valId,
      store_id: this.storeId,
      store_passwd: this.storePasswd,
      v: '1',
      format: 'json',
    });
    return this.get<SslValidationResponse>(`${this.validationUrl}?${qs.toString()}`);
  }

  // ─── Refund ──────────────────────────────────────────────────────────────────

  async initiateRefund(params: {
    bankTranId: string;
    refundAmount: string | number;
    refundRemarks: string;
    refeId?: string;
  }): Promise<SslRefundInitiateResponse> {
    const qs = new URLSearchParams({
      bank_tran_id: params.bankTranId,
      refund_amount: String(params.refundAmount),
      refund_remarks: params.refundRemarks,
      refe_id: params.refeId ?? '',
      store_id: this.storeId,
      store_passwd: this.storePasswd,
      v: '1',
      format: 'json',
    });
    return this.get<SslRefundInitiateResponse>(`${this.refundUrl}?${qs.toString()}`);
  }

  async refundQuery(refundRefId: string): Promise<SslRefundQueryResponse> {
    const qs = new URLSearchParams({
      refund_ref_id: refundRefId,
      store_id: this.storeId,
      store_passwd: this.storePasswd,
      v: '1',
      format: 'json',
    });
    return this.get<SslRefundQueryResponse>(`${this.refundQueryUrl}?${qs.toString()}`);
  }

  // ─── Transaction queries ─────────────────────────────────────────────────────

  async transactionQueryBySessionId(sessionkey: string): Promise<Record<string, unknown>> {
    const qs = new URLSearchParams({
      sessionkey,
      store_id: this.storeId,
      store_passwd: this.storePasswd,
      v: '1',
      format: 'json',
    });
    return this.get(`${this.txnQueryBySessionUrl}?${qs.toString()}`);
  }

  async transactionQueryByTransactionId(tranId: string): Promise<Record<string, unknown>> {
    const qs = new URLSearchParams({
      tran_id: tranId,
      store_id: this.storeId,
      store_passwd: this.storePasswd,
      v: '1',
      format: 'json',
    });
    return this.get(`${this.txnQueryByTranIdUrl}?${qs.toString()}`);
  }

  // ─── HTTP helpers ────────────────────────────────────────────────────────────

  private async post<T>(url: string, body: URLSearchParams): Promise<T> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    return this.parseJson<T>(res, url);
  }

  private async get<T>(url: string): Promise<T> {
    const res = await fetch(url, { method: 'GET' });
    return this.parseJson<T>(res, url);
  }

  private async parseJson<T>(res: Response, url: string): Promise<T> {
    const text = await res.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      this.logger.error(`SSLCommerz call to ${url} returned non-JSON (status ${res.status}): ${text.slice(0, 300)}`);
      throw new Error(`SSLCommerz gateway returned an unexpected response (HTTP ${res.status})`);
    }
  }
}
