import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { WithdrawalStatus } from '@prisma/client';
import Decimal from 'decimal.js';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionService } from '../transaction/transaction.service';
import { WalletService } from '../wallet/wallet.service';
import { PspSignatureService } from './psp-signature.service';
import { PaymentMethodService } from './payment-method.service';

export interface RequestWithdrawalParams {
  userId: string;
  amount: Decimal | string | number;
  currency?: string;
  pspProvider: string;
  /** Raw payout details — still accepted for non-mobile-wallet providers
   * (e.g. an ad-hoc bank transfer) that haven't been saved as a PaymentMethod.
   * Ignored when paymentMethodId is present. */
  payoutDetails?: Record<string, unknown>;
  /** Saved bKash/Nagad/Rocket/Upay/mCash/Tap/bank/card method to pay out to.
   * When omitted, the user's current default payment method is used — this
   * is what lets a user keep several accounts on file but only ever have to
   * pick one, switchable at any time via PaymentMethodService.setDefault(). */
  paymentMethodId?: string;
  metadata?: Record<string, unknown>;
}

export interface RequestWithdrawalResult {
  withdrawalId: string;
  status: WithdrawalStatus;
}

@Injectable()
export class WithdrawalService {
  private readonly logger = new Logger(WithdrawalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly transactionService: TransactionService,
    private readonly walletService: WalletService,
    private readonly pspSignature: PspSignatureService,
    private readonly paymentMethodService: PaymentMethodService,
  ) {}

  // ─── Request ────────────────────────────────────────────────────────────────

  async request(params: RequestWithdrawalParams): Promise<RequestWithdrawalResult> {
    const amount = this.parseAmount(params.amount);
    const currency = params.currency ?? 'USD';

    // Validate wallet state — hard checks.
    const wallet = await this.walletService.getWalletByUserId(params.userId);
    await this.walletService.assertWalletActive(wallet.id);

    // Advisory balance check — the hard locked check happens in transactionService.withdraw()
    // at settlement time. This is an early-fail for UX.
    const balanceResult = await this.walletService.getBalance(params.userId);
    const currentBalance = new Decimal(balanceResult.balance);
    if (currentBalance.lessThan(amount)) {
      throw new BadRequestException(
        `Insufficient funds: balance ${currentBalance.toFixed(2)}, required ${amount.toFixed(2)}`,
      );
    }

    // Resolve where the payout actually goes: an explicitly chosen saved
    // method, else the user's current default. Mobile-wallet providers
    // (sslcommerz routes to bKash/Nagad/etc.) always require one on file;
    // other providers may still pass raw payoutDetails directly.
    let resolvedPayoutDetails: Record<string, unknown>;
    let paymentMethodId: string | undefined;

    if (params.paymentMethodId || params.pspProvider === 'sslcommerz') {
      const method = await this.paymentMethodService.resolveForWithdrawal(
        params.userId,
        params.paymentMethodId,
      );
      paymentMethodId = method.id;
      resolvedPayoutDetails = this.paymentMethodService.toPayoutSnapshot(method);
    } else {
      resolvedPayoutDetails = params.payoutDetails ?? {};
    }

    // KYC gate: verified users skip straight to admin review.
    const user = await this.prisma.user.findUnique({
      where: { id: params.userId },
      select: { kycVerified: true },
    });
    const initialStatus =
      user?.kycVerified === true
        ? WithdrawalStatus.PENDING_REVIEW
        : WithdrawalStatus.PENDING_KYC;

    const withdrawal = await this.prisma.withdrawal.create({
      data: {
        userId: params.userId,
        amount: amount.toFixed(8),
        currency,
        pspProvider: params.pspProvider,
        payoutDetails: resolvedPayoutDetails as any,
        paymentMethodId,
        metadata: (params.metadata ?? null) as any,
        status: initialStatus,
      },
    });

    this.logger.log(
      `Withdrawal requested: id=${withdrawal.id} userId=${params.userId} amount=${amount.toFixed(2)} status=${initialStatus} paymentMethodId=${paymentMethodId ?? 'n/a'}`,
    );

    return { withdrawalId: withdrawal.id, status: initialStatus };
  }

  // ─── Admin: approve ─────────────────────────────────────────────────────────

  async approve(withdrawalId: string, adminId: string): Promise<void> {
    const withdrawal = await this.findById(withdrawalId);

    if (withdrawal.status !== WithdrawalStatus.PENDING_REVIEW) {
      throw new BadRequestException(
        `Withdrawal ${withdrawalId} is in status ${withdrawal.status}, expected PENDING_REVIEW`,
      );
    }

    // Stub: in production this calls the PSP SDK to initiate a payout.
    const pspPayoutId = `payout_${uuidv4()}`;

    await this.prisma.withdrawal.update({
      where: { id: withdrawalId },
      data: {
        status: WithdrawalStatus.PROCESSING,
        reviewedBy: adminId,
        reviewedAt: new Date(),
        pspPayoutId,
      },
    });

    this.logger.log(
      `Withdrawal approved: id=${withdrawalId} admin=${adminId} pspPayoutId=${pspPayoutId}`,
    );
  }

  // ─── Admin: reject ──────────────────────────────────────────────────────────

  async reject(withdrawalId: string, adminId: string, reason: string): Promise<void> {
    const withdrawal = await this.findById(withdrawalId);

    const rejectable: WithdrawalStatus[] = [
      WithdrawalStatus.PENDING_KYC,
      WithdrawalStatus.PENDING_REVIEW,
    ];
    if (!rejectable.includes(withdrawal.status)) {
      throw new BadRequestException(
        `Withdrawal ${withdrawalId} cannot be rejected from status ${withdrawal.status}`,
      );
    }

    await this.prisma.withdrawal.update({
      where: { id: withdrawalId },
      data: {
        status: WithdrawalStatus.REJECTED,
        reviewedBy: adminId,
        reviewedAt: new Date(),
        rejectionReason: reason,
      },
    });

    this.logger.log(`Withdrawal rejected: id=${withdrawalId} admin=${adminId} reason=${reason}`);
  }

  // ─── User: cancel ───────────────────────────────────────────────────────────

  async cancel(withdrawalId: string, userId: string): Promise<void> {
    const withdrawal = await this.findById(withdrawalId);

    if (withdrawal.userId !== userId) {
      throw new ForbiddenException(
        `Withdrawal ${withdrawalId} does not belong to user ${userId}`,
      );
    }

    const cancellable: WithdrawalStatus[] = [
      WithdrawalStatus.PENDING_KYC,
      WithdrawalStatus.PENDING_REVIEW,
    ];
    if (!cancellable.includes(withdrawal.status)) {
      throw new BadRequestException(
        `Withdrawal ${withdrawalId} cannot be cancelled from status ${withdrawal.status}`,
      );
    }

    await this.prisma.withdrawal.update({
      where: { id: withdrawalId },
      data: { status: WithdrawalStatus.CANCELLED },
    });

    this.logger.log(`Withdrawal cancelled: id=${withdrawalId} userId=${userId}`);
  }

  // ─── Webhook ────────────────────────────────────────────────────────────────

  async handleWebhook(
    provider: string,
    signatureHeader: string,
    rawBody: Buffer,
  ): Promise<void> {
    this.pspSignature.verify(provider, signatureHeader, rawBody);

    let event: { type: string; data: Record<string, unknown> };
    try {
      event = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new BadRequestException('Webhook body is not valid JSON');
    }

    switch (event.type) {
      case 'payout.paid':
      case 'transfer.paid':
        await this.handleSuccess(event.data);
        break;
      case 'payout.failed':
      case 'transfer.failed':
        await this.handleFailure(event.data);
        break;
      default:
        this.logger.debug(`Unhandled withdrawal webhook event type: ${event.type}`);
    }
  }

  // ─── Queries ────────────────────────────────────────────────────────────────

  async findById(withdrawalId: string) {
    const w = await this.prisma.withdrawal.findUnique({ where: { id: withdrawalId } });
    if (!w) throw new NotFoundException(`Withdrawal ${withdrawalId} not found`);
    return w;
  }

  async listByUser(userId: string, skip = 0, take = 50) {
    return this.prisma.withdrawal.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
  }

  /**
   * Admin queue of withdrawals awaiting review (or another status).
   * Default: PENDING_REVIEW sorted oldest-first (FIFO for fairness).
   */
  async getAdminQueue(
    status: WithdrawalStatus = WithdrawalStatus.PENDING_REVIEW,
    skip = 0,
    take = 50,
  ) {
    return this.prisma.withdrawal.findMany({
      where: { status },
      orderBy: { createdAt: 'asc' },
      skip,
      take,
    });
  }

  // ─── Private: event routing ─────────────────────────────────────────────────

  private async handleSuccess(data: Record<string, unknown>): Promise<void> {
    const pspPayoutId = (data['pspPayoutId'] ?? data['id']) as string | undefined;
    const pspReference = data['pspReference'] as string | undefined;

    if (!pspPayoutId) {
      this.logger.error(`Withdrawal success webhook missing pspPayoutId: ${JSON.stringify(data)}`);
      return;
    }

    await this.settle(pspPayoutId, pspReference, data);
  }

  private async handleFailure(data: Record<string, unknown>): Promise<void> {
    const pspPayoutId = (data['pspPayoutId'] ?? data['id']) as string | undefined;
    const reason =
      ((data['failure_reason'] ?? data['failure_message']) as string | undefined) ??
      'PSP payout failed';

    if (!pspPayoutId) return;

    const withdrawal = await this.prisma.withdrawal.findFirst({ where: { pspPayoutId } });
    if (withdrawal) await this.markFailed(withdrawal.id, reason);
  }

  // ─── Private: settlement ────────────────────────────────────────────────────

  /**
   * Ledger debit happens here — only after PSP confirms the payout.
   * The authoritative balance check is inside transactionService.withdraw().
   */
  private async settle(
    pspPayoutId: string,
    pspReference: string | undefined,
    webhookData: Record<string, unknown>,
  ): Promise<void> {
    const withdrawal = await this.prisma.withdrawal.findFirst({ where: { pspPayoutId } });

    if (!withdrawal) {
      this.logger.warn(`Withdrawal not found for pspPayoutId=${pspPayoutId}`);
      return;
    }

    if (withdrawal.status === WithdrawalStatus.COMPLETED) {
      this.logger.debug(
        `Withdrawal ${withdrawal.id} already COMPLETED — skipping duplicate webhook`,
      );
      return;
    }

    if (withdrawal.status !== WithdrawalStatus.PROCESSING) {
      this.logger.warn(
        `Withdrawal ${withdrawal.id} in unexpected status ${withdrawal.status} during settlement`,
      );
      return;
    }

    const amount = new Decimal(withdrawal.amount.toString());

    try {
      const txResult = await this.transactionService.withdraw({
        userId: withdrawal.userId,
        amount,
        reference: `withdrawal:${withdrawal.id}`,
        description: `Withdrawal via ${withdrawal.pspProvider}`,
        metadata: {
          withdrawalId: withdrawal.id,
          pspPayoutId,
          pspReference,
          ...webhookData,
        },
      });

      await this.prisma.withdrawal.update({
        where: { id: withdrawal.id },
        data: {
          status: WithdrawalStatus.COMPLETED,
          pspReference: pspReference ?? null,
          transactionId: txResult.transactionId,
        },
      });

      this.logger.log(
        `Withdrawal settled: id=${withdrawal.id} userId=${withdrawal.userId} amount=${amount.toFixed(2)} txId=${txResult.transactionId}`,
      );
    } catch (err) {
      const message = (err as Error).message;
      await this.markFailed(withdrawal.id, message);
      this.logger.error(
        `Withdrawal settlement failed: id=${withdrawal.id} error=${message}`,
      );
    }
  }

  private async markFailed(withdrawalId: string, reason: string): Promise<void> {
    await this.prisma.withdrawal.updateMany({
      where: {
        id: withdrawalId,
        status: {
          notIn: [
            WithdrawalStatus.COMPLETED,
            WithdrawalStatus.FAILED,
            WithdrawalStatus.CANCELLED,
            WithdrawalStatus.REJECTED,
          ],
        },
      },
      data: { status: WithdrawalStatus.FAILED, failureReason: reason },
    });
    this.logger.log(`Withdrawal failed: id=${withdrawalId} reason=${reason}`);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private parseAmount(raw: Decimal | string | number): Decimal {
    const amount = new Decimal(raw);
    if (amount.lessThanOrEqualTo(0)) throw new BadRequestException('Amount must be greater than zero');
    if (amount.decimalPlaces() > 8) throw new BadRequestException('Amount must not exceed 8 decimal places');
    return amount;
  }
}
