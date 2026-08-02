import { NotFoundException } from '@nestjs/common';
import { NotificationStatus } from '@prisma/client';
import { NotificationService } from './notification.service';

function makePrisma(overrides: Record<string, any> = {}) {
  return {
    notification: {
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    notificationPreference: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    ...overrides,
  } as any;
}

function makePrefs(overrides: Record<string, any> = {}) {
  return {
    userId: 'u1',
    emailEnabled: true,
    inAppEnabled: true,
    typeOverrides: {},
    ...overrides,
  };
}

function makeService(prisma = makePrisma()) {
  return new NotificationService(prisma);
}

describe('NotificationService', () => {
  // ─── send ──────────────────────────────────────────────────────────────────

  describe('send', () => {
    it('creates in-app notification when inAppEnabled', async () => {
      const prisma = makePrisma();
      prisma.notificationPreference.findUnique.mockResolvedValue(makePrefs({ emailEnabled: false }));
      prisma.notification.create.mockResolvedValue({ id: 'n-1' });

      const svc = makeService(prisma);
      await svc.send('u1', 'deposit.confirmed', 'Deposit OK', 'Your deposit arrived.');

      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'u1', type: 'deposit.confirmed', title: 'Deposit OK' }),
        }),
      );
    });

    it('sends to registered email channel when emailEnabled', async () => {
      const prisma = makePrisma();
      prisma.notificationPreference.findUnique.mockResolvedValue(makePrefs({ inAppEnabled: false }));
      prisma.notification.create.mockResolvedValue({ id: 'n-2' });

      const svc = makeService(prisma);
      const channel = { channelName: 'email', send: jest.fn().mockResolvedValue(undefined) };
      svc.registerChannel(channel as any);

      await svc.send('u1', 'test', 'Title', 'Body');
      expect(channel.send).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', title: 'Title' }));
    });

    it('returns null and skips channels when type is disabled in overrides', async () => {
      const prisma = makePrisma();
      prisma.notificationPreference.findUnique.mockResolvedValue(
        makePrefs({ typeOverrides: { 'deposit.confirmed': false } }),
      );
      const svc = makeService(prisma);
      const channel = { channelName: 'email', send: jest.fn() };
      svc.registerChannel(channel as any);

      const result = await svc.send('u1', 'deposit.confirmed', 'T', 'B');
      expect(result).toBeNull();
      expect(channel.send).not.toHaveBeenCalled();
    });

    it('swallows channel errors and continues', async () => {
      const prisma = makePrisma();
      prisma.notificationPreference.findUnique.mockResolvedValue(makePrefs({ inAppEnabled: false }));

      const svc = makeService(prisma);
      const bad = { channelName: 'bad', send: jest.fn().mockRejectedValue(new Error('SMTP down')) };
      const good = { channelName: 'good', send: jest.fn().mockResolvedValue(undefined) };
      svc.registerChannel(bad as any);
      svc.registerChannel(good as any);

      await expect(svc.send('u1', 'test', 'T', 'B')).resolves.not.toThrow();
      expect(good.send).toHaveBeenCalled();
    });

    it('creates preferences for user with no record', async () => {
      const prisma = makePrisma();
      prisma.notificationPreference.findUnique.mockResolvedValue(null);
      prisma.notificationPreference.create.mockResolvedValue(makePrefs());
      prisma.notification.create.mockResolvedValue({ id: 'n-3' });

      const svc = makeService(prisma);
      await svc.send('new-user', 'welcome', 'Welcome', 'Hello!');
      expect(prisma.notificationPreference.create).toHaveBeenCalled();
    });
  });

  // ─── getMyNotifications ────────────────────────────────────────────────────

  describe('getMyNotifications', () => {
    it('returns all notifications by default', async () => {
      const prisma = makePrisma();
      const notifs = [{ id: 'n1' }, { id: 'n2' }];
      prisma.notification.findMany.mockResolvedValue(notifs);

      const svc = makeService(prisma);
      const result = await svc.getMyNotifications('u1');
      expect(result).toBe(notifs);
      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'u1' } }),
      );
    });

    it('filters to UNREAD when unreadOnly=true', async () => {
      const prisma = makePrisma();
      prisma.notification.findMany.mockResolvedValue([]);

      const svc = makeService(prisma);
      await svc.getMyNotifications('u1', true);

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'u1', status: NotificationStatus.UNREAD } }),
      );
    });
  });

  // ─── markRead ─────────────────────────────────────────────────────────────

  describe('markRead', () => {
    it('marks notification as READ', async () => {
      const prisma = makePrisma();
      prisma.notification.findUnique.mockResolvedValue({ id: 'n1', userId: 'u1', status: NotificationStatus.UNREAD });
      prisma.notification.update.mockResolvedValue({});

      const svc = makeService(prisma);
      await svc.markRead('u1', 'n1');

      expect(prisma.notification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: NotificationStatus.READ, readAt: expect.any(Date) }),
        }),
      );
    });

    it('throws NotFoundException for unknown notification', async () => {
      const prisma = makePrisma();
      prisma.notification.findUnique.mockResolvedValue(null);

      const svc = makeService(prisma);
      await expect(svc.markRead('u1', 'missing')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when notification belongs to different user', async () => {
      const prisma = makePrisma();
      prisma.notification.findUnique.mockResolvedValue({ id: 'n1', userId: 'other' });

      const svc = makeService(prisma);
      await expect(svc.markRead('u1', 'n1')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── dismiss ──────────────────────────────────────────────────────────────

  describe('dismiss', () => {
    it('marks notification as DISMISSED', async () => {
      const prisma = makePrisma();
      prisma.notification.findUnique.mockResolvedValue({ id: 'n1', userId: 'u1' });
      prisma.notification.update.mockResolvedValue({});

      const svc = makeService(prisma);
      await svc.dismiss('u1', 'n1');

      expect(prisma.notification.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: NotificationStatus.DISMISSED } }),
      );
    });
  });

  // ─── markAllRead ──────────────────────────────────────────────────────────

  describe('markAllRead', () => {
    it('updates all UNREAD for user', async () => {
      const prisma = makePrisma();
      prisma.notification.updateMany.mockResolvedValue({ count: 5 });

      const svc = makeService(prisma);
      await svc.markAllRead('u1');

      expect(prisma.notification.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u1', status: NotificationStatus.UNREAD },
          data: expect.objectContaining({ status: NotificationStatus.READ }),
        }),
      );
    });
  });

  // ─── updatePreferences ────────────────────────────────────────────────────

  describe('updatePreferences', () => {
    it('updates email and inApp flags', async () => {
      const prisma = makePrisma();
      prisma.notificationPreference.findUnique.mockResolvedValue(makePrefs());
      prisma.notificationPreference.update.mockResolvedValue({});

      const svc = makeService(prisma);
      await svc.updatePreferences('u1', { emailEnabled: false, inAppEnabled: true });

      expect(prisma.notificationPreference.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ emailEnabled: false, inAppEnabled: true }) }),
      );
    });

    it('creates preferences if none exist before updating', async () => {
      const prisma = makePrisma();
      prisma.notificationPreference.findUnique.mockResolvedValue(null);
      prisma.notificationPreference.create.mockResolvedValue(makePrefs());
      prisma.notificationPreference.update.mockResolvedValue({});

      const svc = makeService(prisma);
      await svc.updatePreferences('u1', { emailEnabled: false });
      expect(prisma.notificationPreference.create).toHaveBeenCalled();
    });
  });

  // ─── event listeners ──────────────────────────────────────────────────────

  describe('event listeners', () => {
    it('onDepositCompleted sends deposit.confirmed notification', async () => {
      const svc = makeService();
      const spy = jest.spyOn(svc, 'send').mockResolvedValue(null as any);
      await svc.onDepositCompleted({ userId: 'u1', amount: '100', currency: 'USD' });
      expect(spy).toHaveBeenCalledWith('u1', 'deposit.confirmed', expect.any(String), expect.any(String));
    });

    it('onWithdrawalApproved sends withdrawal.approved notification', async () => {
      const svc = makeService();
      const spy = jest.spyOn(svc, 'send').mockResolvedValue(null as any);
      await svc.onWithdrawalApproved({ userId: 'u1', amount: '50', currency: 'USD' });
      expect(spy).toHaveBeenCalledWith('u1', 'withdrawal.approved', expect.any(String), expect.any(String));
    });

    it('onWithdrawalRejected sends withdrawal.rejected notification', async () => {
      const svc = makeService();
      const spy = jest.spyOn(svc, 'send').mockResolvedValue(null as any);
      await svc.onWithdrawalRejected({ userId: 'u1', reason: 'Docs missing' });
      expect(spy).toHaveBeenCalledWith('u1', 'withdrawal.rejected', expect.any(String), expect.stringContaining('Docs missing'));
    });

    it('onVipTierPromoted sends vip.promoted notification', async () => {
      const svc = makeService();
      const spy = jest.spyOn(svc, 'send').mockResolvedValue(null as any);
      await svc.onVipTierPromoted({ userId: 'u1', newTier: 2 });
      expect(spy).toHaveBeenCalledWith('u1', 'vip.promoted', expect.any(String), expect.stringContaining('Tier 2'));
    });

    it('onBonusAwarded sends bonus.awarded notification', async () => {
      const svc = makeService();
      const spy = jest.spyOn(svc, 'send').mockResolvedValue(null as any);
      await svc.onBonusAwarded({ userId: 'u1', amount: '25', bonusType: 'WELCOME' });
      expect(spy).toHaveBeenCalledWith('u1', 'bonus.awarded', expect.any(String), expect.any(String));
    });

    it('onAccountLocked sends account.locked notification', async () => {
      const svc = makeService();
      const spy = jest.spyOn(svc, 'send').mockResolvedValue(null as any);
      await svc.onAccountLocked({ userId: 'u1' });
      expect(spy).toHaveBeenCalledWith('u1', 'account.locked', expect.any(String), expect.any(String));
    });

    it('event listeners swallow send errors', async () => {
      const svc = makeService();
      jest.spyOn(svc, 'send').mockRejectedValue(new Error('DB down'));
      await expect(svc.onDepositCompleted({ userId: 'u1', amount: '100', currency: 'USD' })).resolves.not.toThrow();
    });
  });
});
