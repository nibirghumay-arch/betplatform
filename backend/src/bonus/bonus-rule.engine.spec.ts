import { BonusType } from '@prisma/client';
import Decimal from 'decimal.js';
import { BonusRuleEngine } from './bonus-rule.engine';

// ─── Mock factories ───────────────────────────────────────────────────────────

function makePrisma(overrides: Record<string, any> = {}) {
  return {
    bonusRule: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    bonusClaim: {
      count: jest.fn().mockResolvedValue(0),
    },
    ...overrides,
  } as any;
}

function makeBonusService(overrides: Record<string, any> = {}) {
  return {
    grant: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as any;
}

function makeEngine({ prisma = makePrisma(), bonusService = makeBonusService() } = {}) {
  return new BonusRuleEngine(prisma, bonusService);
}

function makeRule(overrides: Record<string, any> = {}) {
  return {
    id: 'rule-1',
    name: 'Welcome Bonus',
    bonusType: BonusType.WELCOME,
    config: { amount: 100, wageringMultiplier: 30, expiryDays: 30 },
    maxClaimsPerUser: null,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('BonusRuleEngine', () => {
  // ─── evaluate ──────────────────────────────────────────────────────────────

  describe('evaluate', () => {
    it('does nothing when no rules match the trigger event', async () => {
      const prisma = makePrisma();
      prisma.bonusRule.findMany.mockResolvedValue([]);
      const bonusService = makeBonusService();

      const engine = makeEngine({ prisma, bonusService });
      await engine.evaluate('u1', 'user.registered', {});

      expect(bonusService.grant).not.toHaveBeenCalled();
    });

    it('calls bonusService.grant for each matching active rule', async () => {
      const prisma = makePrisma();
      prisma.bonusRule.findMany.mockResolvedValue([makeRule(), makeRule({ id: 'rule-2', name: 'Rule 2' })]);
      const bonusService = makeBonusService();

      const engine = makeEngine({ prisma, bonusService });
      await engine.evaluate('u1', 'user.registered', {});

      expect(bonusService.grant).toHaveBeenCalledTimes(2);
    });

    it('resolves fixed amount from config.amount', async () => {
      const prisma = makePrisma();
      prisma.bonusRule.findMany.mockResolvedValue([
        makeRule({ config: { amount: 50, wageringMultiplier: 20 } }),
      ]);
      const bonusService = makeBonusService();

      const engine = makeEngine({ prisma, bonusService });
      await engine.evaluate('u1', 'user.registered', {});

      const call = bonusService.grant.mock.calls[0][0];
      expect(call.amount.toFixed(2)).toBe('50.00');
      expect(call.wageringRequirement.toFixed(2)).toBe('1000.00'); // 50 * 20
    });

    it('resolves deposit match amount from config.matchPercent + context.depositAmount', async () => {
      const prisma = makePrisma();
      prisma.bonusRule.findMany.mockResolvedValue([
        makeRule({
          bonusType: BonusType.DEPOSIT,
          config: { matchPercent: 1.0, maxAmount: 200, wageringMultiplier: 25 },
        }),
      ]);
      const bonusService = makeBonusService();

      const engine = makeEngine({ prisma, bonusService });
      await engine.evaluate('u1', 'deposit.completed', { depositAmount: '150', currency: 'USD' });

      const call = bonusService.grant.mock.calls[0][0];
      expect(call.amount.toFixed(2)).toBe('150.00'); // 150 * 1.0 = 150 (≤ maxAmount 200)
    });

    it('caps deposit bonus at maxAmount', async () => {
      const prisma = makePrisma();
      prisma.bonusRule.findMany.mockResolvedValue([
        makeRule({
          bonusType: BonusType.DEPOSIT,
          config: { matchPercent: 1.0, maxAmount: 100, wageringMultiplier: 25 },
        }),
      ]);
      const bonusService = makeBonusService();

      const engine = makeEngine({ prisma, bonusService });
      await engine.evaluate('u1', 'deposit.completed', { depositAmount: '300', currency: 'USD' });

      const call = bonusService.grant.mock.calls[0][0];
      expect(call.amount.toFixed(2)).toBe('100.00'); // capped at maxAmount
    });

    it('resolves VIP tier bonus from context.bonusAmount', async () => {
      const prisma = makePrisma();
      prisma.bonusRule.findMany.mockResolvedValue([
        makeRule({
          bonusType: BonusType.VIP_TIER,
          config: { wageringMultiplier: 10 },
        }),
      ]);
      const bonusService = makeBonusService();

      const engine = makeEngine({ prisma, bonusService });
      await engine.evaluate('u1', 'vip.tier.promoted', { newTier: 2, bonusAmount: '75' });

      const call = bonusService.grant.mock.calls[0][0];
      expect(call.amount.toFixed(2)).toBe('75.00');
    });

    it('skips rule when resolved amount is null (no config.amount or context)', async () => {
      const prisma = makePrisma();
      prisma.bonusRule.findMany.mockResolvedValue([
        makeRule({ config: { wageringMultiplier: 10 } }), // no amount, no matchPercent
      ]);
      const bonusService = makeBonusService();

      const engine = makeEngine({ prisma, bonusService });
      await engine.evaluate('u1', 'user.registered', {}); // no depositAmount or bonusAmount in context

      expect(bonusService.grant).not.toHaveBeenCalled();
    });

    it('skips when user has exhausted maxClaimsPerUser', async () => {
      const prisma = makePrisma();
      prisma.bonusRule.findMany.mockResolvedValue([makeRule({ maxClaimsPerUser: 1 })]);
      prisma.bonusClaim.count.mockResolvedValue(1);
      const bonusService = makeBonusService();

      const engine = makeEngine({ prisma, bonusService });
      await engine.evaluate('u1', 'user.registered', {});

      expect(bonusService.grant).not.toHaveBeenCalled();
    });

    it('allows grant when user is under maxClaimsPerUser limit', async () => {
      const prisma = makePrisma();
      prisma.bonusRule.findMany.mockResolvedValue([makeRule({ maxClaimsPerUser: 3 })]);
      prisma.bonusClaim.count.mockResolvedValue(1);
      const bonusService = makeBonusService();

      const engine = makeEngine({ prisma, bonusService });
      await engine.evaluate('u1', 'user.registered', {});

      expect(bonusService.grant).toHaveBeenCalled();
    });

    it('sets expiresAt when config.expiryDays is defined', async () => {
      const prisma = makePrisma();
      prisma.bonusRule.findMany.mockResolvedValue([
        makeRule({ config: { amount: 10, wageringMultiplier: 5, expiryDays: 7 } }),
      ]);
      const bonusService = makeBonusService();

      const engine = makeEngine({ prisma, bonusService });
      await engine.evaluate('u1', 'user.registered', {});

      const call = bonusService.grant.mock.calls[0][0];
      expect(call.expiresAt).toBeInstanceOf(Date);
      const expectedExpiry = Date.now() + 7 * 86400_000;
      expect(Math.abs(call.expiresAt.getTime() - expectedExpiry)).toBeLessThan(2000);
    });

    it('does not set expiresAt when expiryDays is absent', async () => {
      const prisma = makePrisma();
      prisma.bonusRule.findMany.mockResolvedValue([
        makeRule({ config: { amount: 10, wageringMultiplier: 5 } }),
      ]);
      const bonusService = makeBonusService();

      const engine = makeEngine({ prisma, bonusService });
      await engine.evaluate('u1', 'user.registered', {});

      const call = bonusService.grant.mock.calls[0][0];
      expect(call.expiresAt).toBeUndefined();
    });

    it('swallows bonusService.grant errors and continues processing remaining rules', async () => {
      const prisma = makePrisma();
      prisma.bonusRule.findMany.mockResolvedValue([
        makeRule({ id: 'rule-fail', name: 'Failing Rule' }),
        makeRule({ id: 'rule-ok', name: 'OK Rule' }),
      ]);
      let callCount = 0;
      const bonusService = makeBonusService({
        grant: jest.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) throw new Error('Grant failed');
          return Promise.resolve();
        }),
      });

      const engine = makeEngine({ prisma, bonusService });
      await expect(engine.evaluate('u1', 'user.registered', {})).resolves.not.toThrow();

      expect(bonusService.grant).toHaveBeenCalledTimes(2);
    });
  });

  // ─── event listener wiring ─────────────────────────────────────────────────

  describe('event listener delegation', () => {
    it('onUserRegistered calls evaluate with user.registered', async () => {
      const engine = makeEngine();
      const spy = jest.spyOn(engine, 'evaluate').mockResolvedValue();
      await engine.onUserRegistered({ userId: 'u1' } as any);
      expect(spy).toHaveBeenCalledWith('u1', 'user.registered', { userId: 'u1' });
    });

    it('onDepositCompleted calls evaluate with deposit.completed', async () => {
      const engine = makeEngine();
      const spy = jest.spyOn(engine, 'evaluate').mockResolvedValue();
      await engine.onDepositCompleted({ userId: 'u1', depositId: 'd1', amount: '100', currency: 'USD' } as any);
      expect(spy).toHaveBeenCalledWith('u1', 'deposit.completed', expect.objectContaining({ depositAmount: '100' }));
    });

    it('onVipTierPromoted calls evaluate with vip.tier.promoted', async () => {
      const engine = makeEngine();
      const spy = jest.spyOn(engine, 'evaluate').mockResolvedValue();
      await engine.onVipTierPromoted({ userId: 'u1', previousTier: 0, newTier: 1, bonusAmount: '50' } as any);
      expect(spy).toHaveBeenCalledWith('u1', 'vip.tier.promoted', expect.objectContaining({ newTier: 1 }));
    });

    it('onReferralDepositCompleted calls evaluate for the referred user', async () => {
      const engine = makeEngine();
      const spy = jest.spyOn(engine, 'evaluate').mockResolvedValue();
      await engine.onReferralDepositCompleted({ referrerId: 'r1', referredId: 'u1', referralId: 'ref-1', depositAmount: '200' } as any);
      expect(spy).toHaveBeenCalledWith('u1', 'referral.deposit.completed', expect.objectContaining({ referrerId: 'r1' }));
    });
  });
});
