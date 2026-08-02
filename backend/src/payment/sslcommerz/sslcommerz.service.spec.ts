import { BadRequestException } from '@nestjs/common';
import { SslcommerzService } from './sslcommerz.service';

function makeClient(overrides: Record<string, any> = {}) {
  return {
    configured: true,
    init: jest.fn().mockResolvedValue({
      status: 'SUCCESS',
      sessionkey: 'sess-key-1',
      GatewayPageURL: 'https://sandbox.sslcommerz.com/gwprocess/v4/gw.php?Q=pay&sessionkey=sess-key-1',
    }),
    validate: jest.fn(),
    ...overrides,
  } as any;
}

function makeConfig() {
  return { get: jest.fn() } as any;
}

describe('SslcommerzService', () => {
  describe('isConfigured', () => {
    it('reflects the underlying client', () => {
      const svc = new SslcommerzService(makeClient({ configured: false }), makeConfig());
      expect(svc.isConfigured).toBe(false);
    });
  });

  describe('createSession', () => {
    const baseParams = {
      tranId: 'dep-1',
      totalAmount: 500,
      currency: 'BDT',
      successUrl: 'https://api.example.com/payment/deposit/sslcommerz/success',
      failUrl: 'https://api.example.com/payment/deposit/sslcommerz/fail',
      cancelUrl: 'https://api.example.com/payment/deposit/sslcommerz/cancel',
      ipnUrl: 'https://api.example.com/payment/deposit/sslcommerz/ipn',
      customer: { name: 'Jane Doe', email: 'jane@example.com', phone: '01712345678' },
    };

    it('throws if SSLCommerz is not configured', async () => {
      const svc = new SslcommerzService(makeClient({ configured: false }), makeConfig());
      await expect(svc.createSession(baseParams)).rejects.toThrow(BadRequestException);
    });

    it('maps BKASH to the "bkash" multi_card_name gateway code', async () => {
      const client = makeClient();
      const svc = new SslcommerzService(client, makeConfig());
      await svc.createSession({ ...baseParams, restrictToGateway: 'BKASH' });
      expect(client.init).toHaveBeenCalledWith(expect.objectContaining({ multi_card_name: 'bkash' }));
    });

    it('maps ROCKET to the "dbblmobilebanking" gateway code', async () => {
      const client = makeClient();
      const svc = new SslcommerzService(client, makeConfig());
      await svc.createSession({ ...baseParams, restrictToGateway: 'ROCKET' });
      expect(client.init).toHaveBeenCalledWith(
        expect.objectContaining({ multi_card_name: 'dbblmobilebanking' }),
      );
    });

    it('maps each supported mobile wallet to a distinct gateway code', async () => {
      const cases: Array<[string, string]> = [
        ['BKASH', 'bkash'],
        ['NAGAD', 'nagad'],
        ['ROCKET', 'dbblmobilebanking'],
        ['UPAY', 'upay'],
        ['MCASH', 'mcash'],
        ['TAP', 'tap'],
      ];
      for (const [gateway, code] of cases) {
        const client = makeClient();
        const svc = new SslcommerzService(client, makeConfig());
        await svc.createSession({ ...baseParams, restrictToGateway: gateway as any });
        expect(client.init).toHaveBeenCalledWith(expect.objectContaining({ multi_card_name: code }));
      }
    });

    it('omits multi_card_name when no gateway is specified (shows all methods)', async () => {
      const client = makeClient();
      const svc = new SslcommerzService(client, makeConfig());
      await svc.createSession(baseParams);
      expect(client.init).toHaveBeenCalledWith(expect.objectContaining({ multi_card_name: undefined }));
    });

    it('returns gatewayPageUrl and sessionKey on success', async () => {
      const svc = new SslcommerzService(makeClient(), makeConfig());
      const result = await svc.createSession(baseParams);
      expect(result.sessionKey).toBe('sess-key-1');
      expect(result.gatewayPageUrl).toContain('sslcommerz.com');
    });

    it('throws with failedreason when SSLCommerz init returns FAILED', async () => {
      const client = makeClient({
        init: jest.fn().mockResolvedValue({ status: 'FAILED', failedreason: 'Invalid store credentials' }),
      });
      const svc = new SslcommerzService(client, makeConfig());
      await expect(svc.createSession(baseParams)).rejects.toThrow('Invalid store credentials');
    });

    it('defaults customer address fields when not provided', async () => {
      const client = makeClient();
      const svc = new SslcommerzService(client, makeConfig());
      await svc.createSession(baseParams);
      expect(client.init).toHaveBeenCalledWith(
        expect.objectContaining({ cus_add1: 'N/A', cus_city: 'Dhaka', cus_country: 'Bangladesh' }),
      );
    });
  });

  describe('validateTransaction', () => {
    const expected = { tranId: 'dep-1', amount: '500.00', currency: 'BDT' };

    it('returns the validation result when status is VALID and fields match', async () => {
      const client = makeClient({
        validate: jest.fn().mockResolvedValue({
          status: 'VALID',
          tran_id: 'dep-1',
          val_id: 'val-1',
          amount: '500.00',
        }),
      });
      const svc = new SslcommerzService(client, makeConfig());
      const result = await svc.validateTransaction('val-1', expected);
      expect(result.status).toBe('VALID');
    });

    it('accepts VALIDATED status as well as VALID', async () => {
      const client = makeClient({
        validate: jest.fn().mockResolvedValue({
          status: 'VALIDATED',
          tran_id: 'dep-1',
          val_id: 'val-1',
          amount: '500.00',
        }),
      });
      const svc = new SslcommerzService(client, makeConfig());
      await expect(svc.validateTransaction('val-1', expected)).resolves.toBeDefined();
    });

    it('throws when SSLCommerz reports a non-valid status', async () => {
      const client = makeClient({
        validate: jest.fn().mockResolvedValue({ status: 'FAILED', tran_id: 'dep-1', val_id: 'val-1', amount: '500.00' }),
      });
      const svc = new SslcommerzService(client, makeConfig());
      await expect(svc.validateTransaction('val-1', expected)).rejects.toThrow(BadRequestException);
    });

    it('throws on tran_id mismatch (prevents cross-transaction confusion)', async () => {
      const client = makeClient({
        validate: jest.fn().mockResolvedValue({
          status: 'VALID',
          tran_id: 'some-other-deposit',
          val_id: 'val-1',
          amount: '500.00',
        }),
      });
      const svc = new SslcommerzService(client, makeConfig());
      await expect(svc.validateTransaction('val-1', expected)).rejects.toThrow(/tran_id mismatch/);
    });

    it('throws on amount mismatch beyond the rounding tolerance', async () => {
      const client = makeClient({
        validate: jest.fn().mockResolvedValue({
          status: 'VALID',
          tran_id: 'dep-1',
          val_id: 'val-1',
          amount: '450.00',
        }),
      });
      const svc = new SslcommerzService(client, makeConfig());
      await expect(svc.validateTransaction('val-1', expected)).rejects.toThrow(/amount mismatch/);
    });

    it('tolerates a sub-cent rounding difference', async () => {
      const client = makeClient({
        validate: jest.fn().mockResolvedValue({
          status: 'VALID',
          tran_id: 'dep-1',
          val_id: 'val-1',
          amount: '500.005',
        }),
      });
      const svc = new SslcommerzService(client, makeConfig());
      await expect(svc.validateTransaction('val-1', expected)).resolves.toBeDefined();
    });
  });

  describe('describeChannel', () => {
    it('prefers card_issuer', () => {
      const svc = new SslcommerzService(makeClient(), makeConfig());
      expect(svc.describeChannel({ card_issuer: 'bKash', card_brand: 'X', card_type: 'Y' })).toBe('bKash');
    });

    it('falls back to card_brand then card_type then a default label', () => {
      const svc = new SslcommerzService(makeClient(), makeConfig());
      expect(svc.describeChannel({ card_brand: 'Visa' })).toBe('Visa');
      expect(svc.describeChannel({ card_type: 'VISA-Brac' })).toBe('VISA-Brac');
      expect(svc.describeChannel({})).toBe('SSLCommerz');
    });
  });

  describe('parseGatewayCallbackStatus', () => {
    it('maps VALID/VALIDATED to success, CANCELLED to cancelled, everything else to failed', () => {
      const svc = new SslcommerzService(makeClient(), makeConfig());
      expect(svc.parseGatewayCallbackStatus('VALID')).toBe('success');
      expect(svc.parseGatewayCallbackStatus('VALIDATED')).toBe('success');
      expect(svc.parseGatewayCallbackStatus('CANCELLED')).toBe('cancelled');
      expect(svc.parseGatewayCallbackStatus('FAILED')).toBe('failed');
      expect(svc.parseGatewayCallbackStatus('EXPIRED')).toBe('failed');
    });
  });
});
