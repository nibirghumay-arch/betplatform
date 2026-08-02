import { UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import { PspSignatureService } from './psp-signature.service';

function makeService(env: Record<string, string> = {}): PspSignatureService {
  const config = { get: (key: string) => env[key] ?? undefined } as any;
  return new PspSignatureService(config);
}

function hmac(secret: string, payload: string | Buffer): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function stripeHeader(secret: string, rawBody: Buffer, timestamp?: number): string {
  const t = timestamp ?? Math.floor(Date.now() / 1000);
  const sig = hmac(secret, `${t}.${rawBody.toString('utf8')}`);
  return `t=${t},v1=${sig}`;
}

describe('PspSignatureService', () => {
  const stripeSecret = 'whsec_test_stripe_secret';
  const genericSecret = 'generic_webhook_secret';
  const rawBody = Buffer.from('{"type":"payment.succeeded","data":{}}');

  // ─── Stripe ────────────────────────────────────────────────────────────────

  describe('verify (stripe)', () => {
    it('accepts a valid Stripe signature', () => {
      const svc = makeService({ PSP_STRIPE_WEBHOOK_SECRET: stripeSecret });
      const header = stripeHeader(stripeSecret, rawBody);
      expect(() => svc.verify('stripe', header, rawBody)).not.toThrow();
    });

    it('rejects a wrong signature', () => {
      const svc = makeService({ PSP_STRIPE_WEBHOOK_SECRET: stripeSecret });
      const t = Math.floor(Date.now() / 1000);
      const badHeader = `t=${t},v1=${'0'.repeat(64)}`;
      expect(() => svc.verify('stripe', badHeader, rawBody)).toThrow(UnauthorizedException);
    });

    it('rejects a malformed header missing t= field', () => {
      const svc = makeService({ PSP_STRIPE_WEBHOOK_SECRET: stripeSecret });
      expect(() => svc.verify('stripe', 'v1=abc', rawBody)).toThrow(UnauthorizedException);
    });

    it('rejects a malformed header missing v1= field', () => {
      const svc = makeService({ PSP_STRIPE_WEBHOOK_SECRET: stripeSecret });
      expect(() => svc.verify('stripe', 't=12345', rawBody)).toThrow(UnauthorizedException);
    });

    it('rejects a timestamp older than 5 minutes', () => {
      const svc = makeService({ PSP_STRIPE_WEBHOOK_SECRET: stripeSecret });
      const oldTimestamp = Math.floor(Date.now() / 1000) - 400;
      const header = stripeHeader(stripeSecret, rawBody, oldTimestamp);
      expect(() => svc.verify('stripe', header, rawBody)).toThrow(UnauthorizedException);
    });

    it('accepts a timestamp within tolerance', () => {
      const svc = makeService({ PSP_STRIPE_WEBHOOK_SECRET: stripeSecret });
      const recentTimestamp = Math.floor(Date.now() / 1000) - 100;
      const header = stripeHeader(stripeSecret, rawBody, recentTimestamp);
      expect(() => svc.verify('stripe', header, rawBody)).not.toThrow();
    });

    it('skips verification when PSP_STRIPE_WEBHOOK_SECRET is not configured', () => {
      const svc = makeService({});
      expect(() => svc.verify('stripe', 'whatever', rawBody)).not.toThrow();
    });

    it('rejects when signature does not match a tampered body', () => {
      const svc = makeService({ PSP_STRIPE_WEBHOOK_SECRET: stripeSecret });
      const header = stripeHeader(stripeSecret, rawBody);
      const tamperedBody = Buffer.from('{"type":"payment.succeeded","data":{"amount":99999}}');
      expect(() => svc.verify('stripe', header, tamperedBody)).toThrow(UnauthorizedException);
    });
  });

  // ─── Generic ────────────────────────────────────────────────────────────────

  describe('verify (generic provider)', () => {
    it('accepts a valid generic HMAC-SHA256 signature', () => {
      const svc = makeService({ PSP_PAYPAL_WEBHOOK_SECRET: genericSecret });
      const sig = hmac(genericSecret, rawBody);
      expect(() => svc.verify('paypal', sig, rawBody)).not.toThrow();
    });

    it('rejects a wrong generic signature', () => {
      const svc = makeService({ PSP_PAYPAL_WEBHOOK_SECRET: genericSecret });
      expect(() => svc.verify('paypal', '0'.repeat(64), rawBody)).toThrow(UnauthorizedException);
    });

    it('skips verification when secret env var is not configured', () => {
      const svc = makeService({});
      expect(() => svc.verify('paypal', 'whatever', rawBody)).not.toThrow();
    });

    it('uses the uppercase provider name for the env var lookup', () => {
      const svc = makeService({ PSP_PAYNOW_WEBHOOK_SECRET: genericSecret });
      const sig = hmac(genericSecret, rawBody);
      expect(() => svc.verify('paynow', sig, rawBody)).not.toThrow();
    });

    it('rejects when signature does not match a tampered body', () => {
      const svc = makeService({ PSP_PAYPAL_WEBHOOK_SECRET: genericSecret });
      const sig = hmac(genericSecret, rawBody);
      const tampered = Buffer.from('{"tampered":true}');
      expect(() => svc.verify('paypal', sig, tampered)).toThrow(UnauthorizedException);
    });
  });
});
