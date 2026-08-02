import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationChannel, NotificationPayload } from './notification-channel.interface';
import { PLATFORM_EVENTS } from '../events/platform-events';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly channels: NotificationChannel[] = [];

  constructor(private readonly prisma: PrismaService) {}

  registerChannel(channel: NotificationChannel): void {
    this.channels.push(channel);
  }

  // ─── Core send ─────────────────────────────────────────────────────────────

  async send(
    userId: string,
    type: string,
    title: string,
    body: string,
    metadata?: Record<string, unknown>,
  ) {
    const prefs = await this.getOrCreatePreferences(userId);
    const typeOverrides = (prefs.typeOverrides as Record<string, boolean>) ?? {};
    const enabled = typeOverrides[type] ?? true;
    if (!enabled) return null;

    let notification = null;
    if (prefs.inAppEnabled) {
      notification = await this.prisma.notification.create({
        data: { userId, type, title, body, metadata: (metadata ?? null) as any },
      });
    }

    if (prefs.emailEnabled) {
      const payload: NotificationPayload = { userId, type, title, body, metadata };
      for (const ch of this.channels) {
        await ch.send(payload).catch((e) =>
          this.logger.warn(`Channel ${ch.channelName} failed for user ${userId}: ${e.message}`),
        );
      }
    }

    return notification;
  }

  // ─── Read / manage ─────────────────────────────────────────────────────────

  async getMyNotifications(userId: string, unreadOnly = false) {
    return this.prisma.notification.findMany({
      where: {
        userId,
        ...(unreadOnly ? { status: NotificationStatus.UNREAD } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async markRead(userId: string, notificationId: string) {
    const n = await this.prisma.notification.findUnique({ where: { id: notificationId } });
    if (!n || n.userId !== userId) throw new NotFoundException('Notification not found');
    return this.prisma.notification.update({
      where: { id: notificationId },
      data: { status: NotificationStatus.READ, readAt: new Date() },
    });
  }

  async dismiss(userId: string, notificationId: string) {
    const n = await this.prisma.notification.findUnique({ where: { id: notificationId } });
    if (!n || n.userId !== userId) throw new NotFoundException('Notification not found');
    return this.prisma.notification.update({
      where: { id: notificationId },
      data: { status: NotificationStatus.DISMISSED },
    });
  }

  async markAllRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: { userId, status: NotificationStatus.UNREAD },
      data: { status: NotificationStatus.READ, readAt: new Date() },
    });
  }

  // ─── Preferences ───────────────────────────────────────────────────────────

  async getOrCreatePreferences(userId: string) {
    const existing = await this.prisma.notificationPreference.findUnique({ where: { userId } });
    if (existing) return existing;
    return this.prisma.notificationPreference.create({ data: { userId } });
  }

  async updatePreferences(userId: string, dto: { emailEnabled?: boolean; inAppEnabled?: boolean; typeOverrides?: Record<string, boolean> }) {
    await this.getOrCreatePreferences(userId);
    return this.prisma.notificationPreference.update({
      where: { userId },
      data: {
        ...(dto.emailEnabled !== undefined && { emailEnabled: dto.emailEnabled }),
        ...(dto.inAppEnabled !== undefined && { inAppEnabled: dto.inAppEnabled }),
        ...(dto.typeOverrides !== undefined && { typeOverrides: dto.typeOverrides }),
      },
    });
  }

  // ─── Event listeners ───────────────────────────────────────────────────────

  @OnEvent(PLATFORM_EVENTS.DEPOSIT_COMPLETED)
  async onDepositCompleted(payload: { userId: string; amount: string; currency: string }) {
    await this.send(
      payload.userId,
      'deposit.confirmed',
      'Deposit Confirmed',
      `Your deposit of ${payload.currency} ${payload.amount} has been confirmed.`,
    ).catch((e) => this.logger.error('Notification failed: deposit.confirmed', e));
  }

  @OnEvent(PLATFORM_EVENTS.WITHDRAWAL_APPROVED)
  async onWithdrawalApproved(payload: { userId: string; amount: string; currency: string }) {
    await this.send(
      payload.userId,
      'withdrawal.approved',
      'Withdrawal Approved',
      `Your withdrawal of ${payload.currency} ${payload.amount} has been approved and is being processed.`,
    ).catch((e) => this.logger.error('Notification failed: withdrawal.approved', e));
  }

  @OnEvent(PLATFORM_EVENTS.WITHDRAWAL_REJECTED)
  async onWithdrawalRejected(payload: { userId: string; reason?: string }) {
    await this.send(
      payload.userId,
      'withdrawal.rejected',
      'Withdrawal Rejected',
      payload.reason
        ? `Your withdrawal was rejected: ${payload.reason}`
        : 'Your withdrawal request was rejected. Please contact support.',
    ).catch((e) => this.logger.error('Notification failed: withdrawal.rejected', e));
  }

  @OnEvent(PLATFORM_EVENTS.VIP_TIER_PROMOTED)
  async onVipTierPromoted(payload: { userId: string; newTier: number }) {
    await this.send(
      payload.userId,
      'vip.promoted',
      'VIP Level Up!',
      `Congratulations! You have been promoted to VIP Tier ${payload.newTier}.`,
    ).catch((e) => this.logger.error('Notification failed: vip.promoted', e));
  }

  @OnEvent(PLATFORM_EVENTS.BONUS_AWARDED)
  async onBonusAwarded(payload: { userId: string; amount: string; bonusType: string }) {
    await this.send(
      payload.userId,
      'bonus.awarded',
      'Bonus Awarded',
      `You have received a ${payload.bonusType} bonus of ${payload.amount}.`,
    ).catch((e) => this.logger.error('Notification failed: bonus.awarded', e));
  }

  @OnEvent(PLATFORM_EVENTS.ACCOUNT_LOCKED)
  async onAccountLocked(payload: { userId: string }) {
    await this.send(
      payload.userId,
      'account.locked',
      'Account Locked',
      'Your account has been locked. Please contact support for assistance.',
    ).catch((e) => this.logger.error('Notification failed: account.locked', e));
  }
}
