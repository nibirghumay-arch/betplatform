import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { TransactionType, TransactionStatus, WalletType } from '@prisma/client';
import Decimal from 'decimal.js';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { WalletService } from '../wallet/wallet.service';

export interface TransactionResult {
  transactionId: string;
  type: TransactionType;
  status: TransactionStatus;
  amount: string;
  currency: string;
  balance: string;
  reference: string;
}

// ─── Param shapes ─────────────────────────────────────────────────────────────

export interface DepositParams {
  userId: string;
  amount: Decimal | string | number;
  reference?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  initiatedBy?: string;
}

export interface WithdrawParams {
  userId: string;
  amount: Decimal | string | number;
  reference?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  initiatedBy?: string;
}

export interface BetParams {
  userId: string;
  amount: Decimal | string | number;
  gameRoundId: string;
  reference?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface WinParams {
  userId: string;
  amount: Decimal | string | number;
  gameRoundId: string;
  reference?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface RefundParams {
  userId: string;
  amount: Decimal | string | number;
  gameRoundId: string;
  reference?: string;
  description?: string;
}

export interface BonusParams {
  userId: string;
  amount: Decimal | string | number;
  reference?: string;
  description?: string;
  initiatedBy?: string;
}

export interface ManualAdjustmentParams {
  userId: string;
  amount: Decimal | string | number;
  adminId: string;
  reference?: string;
  description: string;
  metadata?: Record<string, unknown>;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class TransactionService {
  private readonly logger = new Logger(TransactionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly wallet: WalletService,
  ) {}

  // ─── DEPOSIT ───────────────────────────────────────────────────────────────

  /**
   * Credit user wallet; debit system wallet.
   * No balance check — deposits always succeed (funds come from outside).
   */
  async deposit(params: DepositParams): Promise<TransactionResult> {
    const amount = this.parseAmount(params.amount);
    const reference = params.reference ?? uuidv4();
    await this.assertReferenceUnique(reference);

    const userWallet = await this.wallet.getWalletByUserId(params.userId);
    await this.wallet.assertWalletActive(userWallet.id);
    const systemWalletId = await this.wallet.getOrCreateSystemWallet(WalletType.SYSTEM, userWallet.currency);

    return this.prisma.$transaction(async (tx) => {
      // Lock user wallet row for the duration of this transaction.
      await tx.$queryRaw`SELECT id FROM wallets WHERE id = ${userWallet.id} FOR UPDATE`;

      const txRecord = await tx.transaction.create({
        data: {
          type: TransactionType.DEPOSIT,
          status: TransactionStatus.PENDING,
          amount: amount.toFixed(8),
          currency: userWallet.currency,
          reference,
          description: params.description ?? 'Deposit',
          metadata: (params.metadata ?? null) as any,
          initiatedBy: params.initiatedBy,
        },
      });

      // DEPOSIT: system (escrow) debits → user credits.
      await this.ledger.createDoubleEntry(tx, {
        debitWalletId: systemWalletId,
        creditWalletId: userWallet.id,
        transactionId: txRecord.id,
        amount,
        currency: userWallet.currency,
        description: params.description ?? 'Deposit',
      });

      const completed = await tx.transaction.update({
        where: { id: txRecord.id },
        data: { status: TransactionStatus.COMPLETED },
      });

      const balance = await this.ledger.getBalanceWithLock(userWallet.id, tx);
      this.logger.log(`DEPOSIT userId=${params.userId} amount=${amount.toFixed(2)} balance=${balance.toFixed(2)} ref=${reference}`);

      return this.buildResult(completed, amount, userWallet.currency, balance, reference);
    });
  }

  // ─── WITHDRAWAL ────────────────────────────────────────────────────────────

  /**
   * Debit user wallet; credit system wallet.
   * Requires sufficient balance — locks wallet row before checking.
   */
  async withdraw(params: WithdrawParams): Promise<TransactionResult> {
    const amount = this.parseAmount(params.amount);
    const reference = params.reference ?? uuidv4();
    await this.assertReferenceUnique(reference);

    const userWallet = await this.wallet.getWalletByUserId(params.userId);
    await this.wallet.assertWalletActive(userWallet.id);
    const systemWalletId = await this.wallet.getOrCreateSystemWallet(WalletType.SYSTEM, userWallet.currency);

    return this.prisma.$transaction(async (tx) => {
      await this.wallet.validateSufficientFunds(userWallet.id, amount, tx);

      const txRecord = await tx.transaction.create({
        data: {
          type: TransactionType.WITHDRAWAL,
          status: TransactionStatus.PENDING,
          amount: amount.toFixed(8),
          currency: userWallet.currency,
          reference,
          description: params.description ?? 'Withdrawal',
          metadata: (params.metadata ?? null) as any,
          initiatedBy: params.initiatedBy,
        },
      });

      // WITHDRAWAL: user debits → system credits.
      await this.ledger.createDoubleEntry(tx, {
        debitWalletId: userWallet.id,
        creditWalletId: systemWalletId,
        transactionId: txRecord.id,
        amount,
        currency: userWallet.currency,
        description: params.description ?? 'Withdrawal',
      });

      const completed = await tx.transaction.update({
        where: { id: txRecord.id },
        data: { status: TransactionStatus.COMPLETED },
      });

      const balance = await this.ledger.getBalanceWithLock(userWallet.id, tx);
      this.logger.log(`WITHDRAWAL userId=${params.userId} amount=${amount.toFixed(2)} balance=${balance.toFixed(2)} ref=${reference}`);

      return this.buildResult(completed, amount, userWallet.currency, balance, reference);
    });
  }

  // ─── BET ───────────────────────────────────────────────────────────────────

  /**
   * Debit user wallet; credit house wallet.
   * Requires sufficient balance.
   */
  async bet(params: BetParams): Promise<TransactionResult> {
    const amount = this.parseAmount(params.amount);
    const reference = params.reference ?? `bet:${params.gameRoundId}`;
    await this.assertReferenceUnique(reference);

    const userWallet = await this.wallet.getWalletByUserId(params.userId);
    await this.wallet.assertWalletActive(userWallet.id);
    const houseWalletId = await this.wallet.getOrCreateSystemWallet(WalletType.HOUSE, userWallet.currency);

    return this.prisma.$transaction(async (tx) => {
      await this.wallet.validateSufficientFunds(userWallet.id, amount, tx);

      const txRecord = await tx.transaction.create({
        data: {
          type: TransactionType.BET,
          status: TransactionStatus.PENDING,
          amount: amount.toFixed(8),
          currency: userWallet.currency,
          reference,
          description: params.description ?? `Bet — round ${params.gameRoundId}`,
          metadata: (params.metadata ?? null) as any,
          gameRoundId: params.gameRoundId,
          initiatedBy: params.userId,
        },
      });

      // BET: user debits → house credits.
      await this.ledger.createDoubleEntry(tx, {
        debitWalletId: userWallet.id,
        creditWalletId: houseWalletId,
        transactionId: txRecord.id,
        amount,
        currency: userWallet.currency,
        description: params.description ?? `Bet — round ${params.gameRoundId}`,
      });

      const completed = await tx.transaction.update({
        where: { id: txRecord.id },
        data: { status: TransactionStatus.COMPLETED },
      });

      const balance = await this.ledger.getBalanceWithLock(userWallet.id, tx);

      return this.buildResult(completed, amount, userWallet.currency, balance, reference);
    });
  }

  // ─── WIN ───────────────────────────────────────────────────────────────────

  /**
   * Debit house wallet; credit user wallet.
   */
  async win(params: WinParams): Promise<TransactionResult> {
    const amount = this.parseAmount(params.amount);
    const reference = params.reference ?? `win:${params.gameRoundId}`;
    await this.assertReferenceUnique(reference);

    const userWallet = await this.wallet.getWalletByUserId(params.userId);
    await this.wallet.assertWalletActive(userWallet.id);
    const houseWalletId = await this.wallet.getOrCreateSystemWallet(WalletType.HOUSE, userWallet.currency);

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM wallets WHERE id = ${userWallet.id} FOR UPDATE`;

      const txRecord = await tx.transaction.create({
        data: {
          type: TransactionType.WIN,
          status: TransactionStatus.PENDING,
          amount: amount.toFixed(8),
          currency: userWallet.currency,
          reference,
          description: params.description ?? `Win — round ${params.gameRoundId}`,
          metadata: (params.metadata ?? null) as any,
          gameRoundId: params.gameRoundId,
          initiatedBy: params.userId,
        },
      });

      // WIN: house debits → user credits.
      await this.ledger.createDoubleEntry(tx, {
        debitWalletId: houseWalletId,
        creditWalletId: userWallet.id,
        transactionId: txRecord.id,
        amount,
        currency: userWallet.currency,
        description: params.description ?? `Win — round ${params.gameRoundId}`,
      });

      const completed = await tx.transaction.update({
        where: { id: txRecord.id },
        data: { status: TransactionStatus.COMPLETED },
      });

      const balance = await this.ledger.getBalanceWithLock(userWallet.id, tx);

      return this.buildResult(completed, amount, userWallet.currency, balance, reference);
    });
  }

  // ─── REFUND ────────────────────────────────────────────────────────────────

  /**
   * Return a bet to the user. Debit house wallet; credit user wallet.
   */
  async refund(params: RefundParams): Promise<TransactionResult> {
    const amount = this.parseAmount(params.amount);
    const reference = params.reference ?? `refund:${params.gameRoundId}`;
    await this.assertReferenceUnique(reference);

    const userWallet = await this.wallet.getWalletByUserId(params.userId);
    await this.wallet.assertWalletActive(userWallet.id);
    const houseWalletId = await this.wallet.getOrCreateSystemWallet(WalletType.HOUSE, userWallet.currency);

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM wallets WHERE id = ${userWallet.id} FOR UPDATE`;

      const txRecord = await tx.transaction.create({
        data: {
          type: TransactionType.REFUND,
          status: TransactionStatus.PENDING,
          amount: amount.toFixed(8),
          currency: userWallet.currency,
          reference,
          description: params.description ?? `Refund — round ${params.gameRoundId}`,
          gameRoundId: params.gameRoundId,
          initiatedBy: params.userId,
        },
      });

      // REFUND: house debits → user credits (mirrors BET).
      await this.ledger.createDoubleEntry(tx, {
        debitWalletId: houseWalletId,
        creditWalletId: userWallet.id,
        transactionId: txRecord.id,
        amount,
        currency: userWallet.currency,
        description: params.description ?? `Refund — round ${params.gameRoundId}`,
      });

      const completed = await tx.transaction.update({
        where: { id: txRecord.id },
        data: { status: TransactionStatus.COMPLETED },
      });

      const balance = await this.ledger.getBalanceWithLock(userWallet.id, tx);

      return this.buildResult(completed, amount, userWallet.currency, balance, reference);
    });
  }

  // ─── BONUS_CREDIT ──────────────────────────────────────────────────────────

  /**
   * Award a bonus. Debit bonus pool; credit user wallet.
   */
  async bonusCredit(params: BonusParams): Promise<TransactionResult> {
    const amount = this.parseAmount(params.amount);
    const reference = params.reference ?? `bonus_credit:${uuidv4()}`;
    await this.assertReferenceUnique(reference);

    const userWallet = await this.wallet.getWalletByUserId(params.userId);
    await this.wallet.assertWalletActive(userWallet.id);
    const bonusPoolId = await this.wallet.getOrCreateSystemWallet(WalletType.BONUS_POOL, userWallet.currency);

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM wallets WHERE id = ${userWallet.id} FOR UPDATE`;

      const txRecord = await tx.transaction.create({
        data: {
          type: TransactionType.BONUS_CREDIT,
          status: TransactionStatus.PENDING,
          amount: amount.toFixed(8),
          currency: userWallet.currency,
          reference,
          description: params.description ?? 'Bonus credit',
          initiatedBy: params.initiatedBy,
        },
      });

      // BONUS_CREDIT: bonus pool debits → user credits.
      await this.ledger.createDoubleEntry(tx, {
        debitWalletId: bonusPoolId,
        creditWalletId: userWallet.id,
        transactionId: txRecord.id,
        amount,
        currency: userWallet.currency,
        description: params.description ?? 'Bonus credit',
      });

      const completed = await tx.transaction.update({
        where: { id: txRecord.id },
        data: { status: TransactionStatus.COMPLETED },
      });

      const balance = await this.ledger.getBalanceWithLock(userWallet.id, tx);

      return this.buildResult(completed, amount, userWallet.currency, balance, reference);
    });
  }

  // ─── BONUS_DEBIT ───────────────────────────────────────────────────────────

  /**
   * Reclaim unused bonus. Debit user wallet; credit bonus pool.
   * Requires sufficient balance.
   */
  async bonusDebit(params: BonusParams): Promise<TransactionResult> {
    const amount = this.parseAmount(params.amount);
    const reference = params.reference ?? `bonus_debit:${uuidv4()}`;
    await this.assertReferenceUnique(reference);

    const userWallet = await this.wallet.getWalletByUserId(params.userId);
    await this.wallet.assertWalletActive(userWallet.id);
    const bonusPoolId = await this.wallet.getOrCreateSystemWallet(WalletType.BONUS_POOL, userWallet.currency);

    return this.prisma.$transaction(async (tx) => {
      await this.wallet.validateSufficientFunds(userWallet.id, amount, tx);

      const txRecord = await tx.transaction.create({
        data: {
          type: TransactionType.BONUS_DEBIT,
          status: TransactionStatus.PENDING,
          amount: amount.toFixed(8),
          currency: userWallet.currency,
          reference,
          description: params.description ?? 'Bonus debit',
          initiatedBy: params.initiatedBy,
        },
      });

      // BONUS_DEBIT: user debits → bonus pool credits.
      await this.ledger.createDoubleEntry(tx, {
        debitWalletId: userWallet.id,
        creditWalletId: bonusPoolId,
        transactionId: txRecord.id,
        amount,
        currency: userWallet.currency,
        description: params.description ?? 'Bonus debit',
      });

      const completed = await tx.transaction.update({
        where: { id: txRecord.id },
        data: { status: TransactionStatus.COMPLETED },
      });

      const balance = await this.ledger.getBalanceWithLock(userWallet.id, tx);

      return this.buildResult(completed, amount, userWallet.currency, balance, reference);
    });
  }

  // ─── MANUAL_CREDIT ─────────────────────────────────────────────────────────

  /**
   * Admin-initiated credit. Debit system; credit user. Works even on frozen wallets.
   */
  async manualCredit(params: ManualAdjustmentParams): Promise<TransactionResult> {
    const amount = this.parseAmount(params.amount);
    const reference = params.reference ?? `manual_credit:${uuidv4()}`;
    await this.assertReferenceUnique(reference);

    const userWallet = await this.wallet.getWalletByUserId(params.userId);
    const systemWalletId = await this.wallet.getOrCreateSystemWallet(WalletType.SYSTEM, userWallet.currency);

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM wallets WHERE id = ${userWallet.id} FOR UPDATE`;

      const txRecord = await tx.transaction.create({
        data: {
          type: TransactionType.MANUAL_CREDIT,
          status: TransactionStatus.PENDING,
          amount: amount.toFixed(8),
          currency: userWallet.currency,
          reference,
          description: params.description,
          metadata: (params.metadata ?? null) as any,
          initiatedBy: params.adminId,
        },
      });

      // MANUAL_CREDIT: system debits → user credits.
      await this.ledger.createDoubleEntry(tx, {
        debitWalletId: systemWalletId,
        creditWalletId: userWallet.id,
        transactionId: txRecord.id,
        amount,
        currency: userWallet.currency,
        description: params.description,
      });

      const completed = await tx.transaction.update({
        where: { id: txRecord.id },
        data: { status: TransactionStatus.COMPLETED },
      });

      const balance = await this.ledger.getBalanceWithLock(userWallet.id, tx);
      this.logger.warn(`MANUAL_CREDIT admin=${params.adminId} user=${params.userId} amount=${amount.toFixed(2)} ref=${reference}`);

      return this.buildResult(completed, amount, userWallet.currency, balance, reference);
    });
  }

  // ─── MANUAL_DEBIT ──────────────────────────────────────────────────────────

  /**
   * Admin-initiated debit. Debit user; credit system.
   * Requires sufficient balance.
   */
  async manualDebit(params: ManualAdjustmentParams): Promise<TransactionResult> {
    const amount = this.parseAmount(params.amount);
    const reference = params.reference ?? `manual_debit:${uuidv4()}`;
    await this.assertReferenceUnique(reference);

    const userWallet = await this.wallet.getWalletByUserId(params.userId);
    const systemWalletId = await this.wallet.getOrCreateSystemWallet(WalletType.SYSTEM, userWallet.currency);

    return this.prisma.$transaction(async (tx) => {
      await this.wallet.validateSufficientFunds(userWallet.id, amount, tx);

      const txRecord = await tx.transaction.create({
        data: {
          type: TransactionType.MANUAL_DEBIT,
          status: TransactionStatus.PENDING,
          amount: amount.toFixed(8),
          currency: userWallet.currency,
          reference,
          description: params.description,
          metadata: (params.metadata ?? null) as any,
          initiatedBy: params.adminId,
        },
      });

      // MANUAL_DEBIT: user debits → system credits.
      await this.ledger.createDoubleEntry(tx, {
        debitWalletId: userWallet.id,
        creditWalletId: systemWalletId,
        transactionId: txRecord.id,
        amount,
        currency: userWallet.currency,
        description: params.description,
      });

      const completed = await tx.transaction.update({
        where: { id: txRecord.id },
        data: { status: TransactionStatus.COMPLETED },
      });

      const balance = await this.ledger.getBalanceWithLock(userWallet.id, tx);
      this.logger.warn(`MANUAL_DEBIT admin=${params.adminId} user=${params.userId} amount=${amount.toFixed(2)} ref=${reference}`);

      return this.buildResult(completed, amount, userWallet.currency, balance, reference);
    });
  }

  // ─── Query helpers ─────────────────────────────────────────────────────────

  async getTransaction(transactionId: string) {
    const tx = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      include: { ledgerEntries: { include: { wallet: { select: { id: true, walletType: true, userId: true } } } } },
    });
    if (!tx) throw new NotFoundException(`Transaction ${transactionId} not found`);
    return tx;
  }

  async getTransactionByReference(reference: string) {
    const tx = await this.prisma.transaction.findUnique({ where: { reference } });
    if (!tx) throw new NotFoundException(`Transaction with reference '${reference}' not found`);
    return tx;
  }

  async getTransactionHistory(params: {
    userId: string;
    type?: TransactionType;
    skip?: number;
    take?: number;
  }) {
    const userWallet = await this.wallet.getWalletByUserId(params.userId);
    return this.prisma.transaction.findMany({
      where: {
        ledgerEntries: { some: { walletId: userWallet.id } },
        ...(params.type ? { type: params.type } : {}),
      },
      orderBy: { createdAt: 'desc' },
      skip: params.skip ?? 0,
      take: params.take ?? 50,
    });
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private parseAmount(raw: Decimal | string | number): Decimal {
    const amount = new Decimal(raw);
    if (amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Amount must be greater than zero');
    }
    if (amount.decimalPlaces() > 8) {
      throw new BadRequestException('Amount must not exceed 8 decimal places');
    }
    return amount;
  }

  private async assertReferenceUnique(reference: string): Promise<void> {
    const existing = await this.prisma.transaction.findUnique({
      where: { reference },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(`Duplicate transaction reference: ${reference}`);
    }
  }

  private buildResult(
    tx: { id: string; type: TransactionType; status: TransactionStatus },
    amount: Decimal,
    currency: string,
    balance: Decimal,
    reference: string,
  ): TransactionResult {
    return {
      transactionId: tx.id,
      type: tx.type,
      status: tx.status,
      amount: amount.toFixed(2),
      currency,
      balance: balance.toFixed(2),
      reference,
    };
  }
}
