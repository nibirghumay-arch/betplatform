import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class PspSignatureService {
  private readonly logger = new Logger(PspSignatureService.name);
  private readonly TIMESTAMP_TOLERANCE_SECONDS = 300;

  constructor(private readonly config: ConfigService) {}

  /**
   * Verify the webhook signature for the given provider.
   * Throws UnauthorizedException on failure; returns void on success.
   * Skips verification if the expected secret env var is not configured (logs a warning).
   */
  verify(provider: string, signatureHeader: string, rawBody: Buffer): void {
    if (provider === 'stripe') {
      this.verifyStripe(signatureHeader, rawBody);
    } else {
      this.verifyGeneric(provider, signatureHeader, rawBody);
    }
  }

  // ─── Stripe ─────────────────────────────────────────────────────────────────

  /**
   * Stripe sends: Stripe-Signature: t=<unix>,v1=<hex>
   * Signed payload: "<t>.<rawBody>"
   * Secret env var: PSP_STRIPE_WEBHOOK_SECRET
   */
  private verifyStripe(signatureHeader: string, rawBody: Buffer): void {
    const secret = this.config.get<string>('PSP_STRIPE_WEBHOOK_SECRET');
    if (!secret) {
      this.logger.warn('PSP_STRIPE_WEBHOOK_SECRET not configured — skipping webhook signature verification');
      return;
    }

    const parts: Record<string, string> = {};
    for (const segment of signatureHeader.split(',')) {
      const eq = segment.indexOf('=');
      if (eq !== -1) parts[segment.slice(0, eq)] = segment.slice(eq + 1);
    }

    const timestamp = parts['t'];
    const v1 = parts['v1'];

    if (!timestamp || !v1) {
      throw new UnauthorizedException('Malformed Stripe-Signature header');
    }

    const age = Math.abs(Date.now() / 1000 - parseInt(timestamp, 10));
    if (age > this.TIMESTAMP_TOLERANCE_SECONDS) {
      throw new UnauthorizedException(
        `Webhook timestamp too old: ${Math.round(age)}s (tolerance ${this.TIMESTAMP_TOLERANCE_SECONDS}s)`,
      );
    }

    const payload = `${timestamp}.${rawBody.toString('utf8')}`;
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    this.timingSafeCompare(expected, v1);
  }

  // ─── Generic HMAC-SHA256 ─────────────────────────────────────────────────────

  /**
   * Generic providers send: X-Webhook-Signature: <hex>
   * Signed payload: rawBody
   * Secret env var: PSP_<PROVIDER_UPPER>_WEBHOOK_SECRET
   */
  private verifyGeneric(provider: string, signatureHeader: string, rawBody: Buffer): void {
    const envKey = `PSP_${provider.toUpperCase()}_WEBHOOK_SECRET`;
    const secret = this.config.get<string>(envKey);
    if (!secret) {
      this.logger.warn(`${envKey} not configured — skipping webhook signature verification`);
      return;
    }

    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    this.timingSafeCompare(expected, signatureHeader);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private timingSafeCompare(expected: string, actual: string): void {
    let expectedBuf: Buffer;
    let actualBuf: Buffer;
    try {
      expectedBuf = Buffer.from(expected, 'hex');
      actualBuf = Buffer.from(actual, 'hex');
    } catch {
      throw new UnauthorizedException('Webhook signature verification failed');
    }

    if (
      expectedBuf.length === 0 ||
      expectedBuf.length !== actualBuf.length ||
      !crypto.timingSafeEqual(expectedBuf, actualBuf)
    ) {
      throw new UnauthorizedException('Webhook signature verification failed');
    }
  }
}
