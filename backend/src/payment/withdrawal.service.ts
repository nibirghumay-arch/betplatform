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
    if (params.currency && params.currency.toUpperCase() !== 'BDT') {
      throw new BadRequestException('BetPlatform only supports BDT withdrawals.');
    }
    const currency = 'BDT';

    // Validate wallet state — all user wallets are normalized to BDT by WalletService.
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

    // Reserve the requested funds when the administrator approves the
    // payout. This prevents the player from wagering the amount while the
    // operator is sending it manually or waiting for an external PSP.
    const wallet = await this.walletService.getWalletByUserId(withdrawal.userId);
    await this.walletService.assertWalletActive(wallet.id);
    if (withdrawal.currency !== 'BDT') {
      await this.prisma.withdrawal.update({
        where: { id: withdrawalId },
        data: { currency: 'BDT' },
      });
    }

    const ledgerReference = `withdrawal:${withdrawal.id}`;
    let transaction = await this.prisma.transaction.findUnique({
      where: { reference: ledgerReference },
      select: { id: true },
    });
    if (!transaction) {
      try {
        const result = await this.transactionService.withdraw({
          userId: withdrawal.userId,
          amount: new Decimal(withdrawal.amount.toString()),
          reference: ledgerReference,
          description: `Withdrawal reserve via ${withdrawal.pspProvider}`,
          metadata: { withdrawalId: withdrawal.id, reservedBy: adminId },
          initiatedBy: adminId,
        });
        transaction = { id: result.transactionId };
      } catch (error) {
        transaction = await this.prisma.transaction.findUnique({
          where: { reference: ledgerReference },
          select: { id: true },
        });
        if (!transaction) throw error;
      }
    }

    const pspPayoutId = `payout_${uuidv4()}`;
    await this.prisma.withdrawal.update({
      where: { id: withdrawalId },
      data: {
        status: WithdrawalStatus.PROCESSING,
        reviewedBy: adminId,
        reviewedAt: new Date(),
        pspPayoutId,
        transactionId: transaction.id,
      },
    });

    this.logger.log(
      `Withdrawal approved: id=${withdrawalId} admin=${adminId} pspPayoutId=${pspPayoutId}`,
    );
  }

  /**
   * Complete a withdrawal after the operator has sent the money manually.
   * The site's payment gateway currently has no payout API, so this records
   * the operator's real transfer reference and debits the wallet exactly once.
   */
  async markManuallyPaid(
    withdrawalId: string,
    adminId: string,
    payoutReference: string,
  ): Promise<{ withdrawalId: string; status: WithdrawalStatus; transactionId: string }> {
    const normalizedReference = payoutReference.trim();
    if (normalizedReference.length < 4 || normalizedReference.length > 64) {
      throw new BadRequestException('Enter a valid payout transaction/reference ID');
    }

    const withdrawal = await this.findById(withdrawalId);
    if (withdrawal.status === WithdrawalStatus.COMPLETED && withdrawal.transactionId) {
      return {
        withdrawalId,
        status: withdrawal.status,
        transactionId: withdrawal.transactionId,
      };
    }
    if (withdrawal.status !== WithdrawalStatus.PROCESSING) {
      throw new BadRequestException(
        `Withdrawal ${withdrawalId} must be approved and in PROCESSING before it can be marked paid`,
      );
    }

    const wallet = await this.walletService.getWalletByUserId(withdrawal.userId);
    await this.walletService.assertWalletActive(wallet.id);
    if (withdrawal.currency !== 'BDT') {
      await this.prisma.withdrawal.update({
        where: { id: withdrawalId },
        data: { currency: 'BDT' },
      });
    }

    const ledgerReference = `withdrawal:${withdrawal.id}`;
    let transaction = withdrawal.transactionId
      ? { id: withdrawal.transactionId }
      : await this.prisma.transaction.findUnique({
          where: { reference: ledgerReference },
          select: { id: true },
        });

    // A retry after an interrupted admin action reuses the already-created
    // ledger transaction rather than debiting the wallet twice.
    if (!transaction) {
      try {
        const result = await this.transactionService.withdraw({
          userId: withdrawal.userId,
          amount: new Decimal(withdrawal.amount.toString()),
          reference: ledgerReference,
          description: `Manual payout via ${withdrawal.pspProvider}`,
          metadata: {
            withdrawalId: withdrawal.id,
            manualPayoutReference: normalizedReference,
            markedPaidBy: adminId,
          },
          initiatedBy: adminId,
        });
        transaction = { id: result.transactionId };
      } catch (error) {
        // Handle concurrent double-clicks / retries. The transaction reference
        // is unique, so a second request can recover the winner's transaction.
        transaction = await this.prisma.transaction.findUnique({
          where: { reference: ledgerReference },
          select: { id: true },
        });
        if (!transaction) throw error;
      }
    }

    await this.prisma.withdrawal.updateMany({
      where: {
        id: withdrawal.id,
        status: WithdrawalStatus.PROCESSING,
        transactionId: withdrawal.transactionId ?? null,
      },
      data: {
        status: WithdrawalStatus.COMPLETED,
        reviewedBy: adminId,
        reviewedAt: new Date(),
        pspReference: normalizedReference,
        transactionId: transaction.id,
      },
    });

    const completed = await this.findById(withdrawalId);
    if (completed.status !== WithdrawalStatus.COMPLETED || completed.transactionId !== transaction.id) {
      throw new BadRequestException('Withdrawal status changed while the payout was being recorded');
    }

    this.logger.warn(
      `Manual withdrawal completed: id=${withdrawalId} admin=${adminId} payoutReference=${normalizedReference} txId=${transaction.id}`,
    );
    return {
      withdrawalId,
      status: completed.status,
      transactionId: transaction.id,
    };
  }

  /** Mark an unsent/failed manual payout as failed and release its reserve. */
  async failManualPayout(
    withdrawalId: string,
    adminId: string,
    reason: string,
  ): Promise<{ withdrawalId: string; status: WithdrawalStatus }> {
    const withdrawal = await this.findById(withdrawalId);
    if (withdrawal.status !== WithdrawalStatus.PROCESSING) {
      throw new BadRequestException('Only a PROCESSING withdrawal can be failed by an administrator');
    }
    const normalizedReason = reason.trim();
    if (normalizedReason.length < 4 || normalizedReason.length > 500) {
      throw new BadRequestException('Enter a reason between 4 and 500 characters');
    }

    await this.markFailed(
      withdrawalId,
      `Manual payout marked failed by ${adminId}: ${normalizedReason}`,
    );
    const updated = await this.findById(withdrawalId);
    return { withdrawalId, status: updated.status };
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
      const existingTransaction = withdrawal.transactionId
        ? { id: withdrawal.transactionId }
        : await this.prisma.transaction.findUnique({
            where: { reference: `withdrawal:${withdrawal.id}` },
            select: { id: true },
          });
      const txResult = existingTransaction
        ? { transactionId: existingTransaction.id }
        : await this.transactionService.withdraw({
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
    const withdrawal = await this.prisma.withdrawal.findUnique({
      where: { id: withdrawalId },
    });

    if (
      !withdrawal ||
      withdrawal.status === WithdrawalStatus.COMPLETED ||
      withdrawal.status === WithdrawalStatus.FAILED ||
      withdrawal.status === WithdrawalStatus.CANCELLED ||
      withdrawal.status === WithdrawalStatus.REJECTED
    ) {
      return;
    }

    // Funds were reserved from the player's wallet when an admin approved
    // this withdrawal. If the external payout fails, release the reserve back
    // to the same wallet using a unique reversal transaction reference.
    const ledgerReference = `withdrawal:${withdrawal.id}`;
    const reversalReference = `withdrawal-reversal:${withdrawal.id}`;
    let reservation = withdrawal.transactionId
      ? { id: withdrawal.transactionId }
      : await this.prisma.transaction.findUnique({
          where: { reference: ledgerReference },
          select: { id: true },
        });

    if (reservation) {
      let reversal = await this.prisma.transaction.findUnique({
        where: { reference: reversalReference },
        select: { id: true },
      });
      if (!reversal) {
        try {
          const result = await this.transactionService.manualCredit({
            userId: withdrawal.userId,
            adminId: withdrawal.reviewedBy ?? 'system',
            amount: new Decimal(withdrawal.amount.toString()),
            reference: reversalReference,
            description: 'Release reserved funds after failed withdrawal payout',
            metadata: { withdrawalId: withdrawal.id, failureReason: reason },
          });
          reversal = { id: result.transactionId };
        } catch (error) {
          reversal = await this.prisma.transaction.findUnique({
            where: { reference: reversalReference },
            select: { id: true },
          });
          if (!reversal) throw error;
        }
      }
    }

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
