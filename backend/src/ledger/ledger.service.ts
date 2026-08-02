import { Injectable, Logger } from '@nestjs/common';
import { Prisma, EntryType } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';

export interface DoubleEntryParams {
  debitWalletId: string;
  creditWalletId: string;
  transactionId: string;
  amount: Decimal;
  currency: string;
  description?: string;
}

@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Compute wallet balance without locking. Safe for reads only.
   * Balance = SUM(CREDIT entries) - SUM(DEBIT entries).
   */
  async getBalance(walletId: string): Promise<Decimal> {
    const rows = await this.prisma.$queryRaw<Array<{ balance: string }>>`
      SELECT COALESCE(
        SUM(CASE WHEN entry_type = 'CREDIT' THEN amount ELSE -amount END),
        0
      )::text AS balance
      FROM ledger_entries
      WHERE wallet_id = ${walletId}
    `;
    return new Decimal(rows[0]?.balance ?? '0');
  }

  /**
   * Acquire a FOR UPDATE row-lock on the wallet, then compute balance.
   * Must be called inside a Prisma interactive transaction.
   * Prevents concurrent writes that would produce a race on balance computation.
   */
  async getBalanceWithLock(
    walletId: string,
    tx: Prisma.TransactionClient,
  ): Promise<Decimal> {
    // Row-lock: held until the surrounding $transaction commits or rolls back.
    await tx.$queryRaw`
      SELECT id FROM wallets WHERE id = ${walletId} FOR UPDATE
    `;

    const rows = await tx.$queryRaw<Array<{ balance: string }>>`
      SELECT COALESCE(
        SUM(CASE WHEN entry_type = 'CREDIT' THEN amount ELSE -amount END),
        0
      )::text AS balance
      FROM ledger_entries
      WHERE wallet_id = ${walletId}
    `;
    return new Decimal(rows[0]?.balance ?? '0');
  }

  /**
   * Write one DEBIT entry and one CREDIT entry atomically.
   * Called inside an existing Prisma interactive transaction.
   * Ledger entries are immutable — this is the only write path.
   */
  async createDoubleEntry(
    tx: Prisma.TransactionClient,
    params: DoubleEntryParams,
  ): Promise<void> {
    const { debitWalletId, creditWalletId, transactionId, amount, currency, description } = params;

    if (debitWalletId === creditWalletId) {
      throw new Error('Debit and credit wallet must differ');
    }

    await tx.ledgerEntry.createMany({
      data: [
        {
          walletId: debitWalletId,
          transactionId,
          entryType: EntryType.DEBIT,
          amount: amount.toDecimalPlaces(8).toFixed(8),
          currency,
          description,
        },
        {
          walletId: creditWalletId,
          transactionId,
          entryType: EntryType.CREDIT,
          amount: amount.toDecimalPlaces(8).toFixed(8),
          currency,
          description,
        },
      ],
    });

    this.logger.debug(
      `Double-entry: DEBIT ${debitWalletId} / CREDIT ${creditWalletId} — ${amount.toFixed(8)} ${currency}`,
    );
  }

  async getEntriesForWallet(
    walletId: string,
    params: { skip?: number; take?: number } = {},
  ) {
    return this.prisma.ledgerEntry.findMany({
      where: { walletId },
      orderBy: { createdAt: 'desc' },
      skip: params.skip ?? 0,
      take: params.take ?? 50,
      include: { transaction: { select: { type: true, status: true, reference: true } } },
    });
  }

  async getEntriesForTransaction(transactionId: string) {
    return this.prisma.ledgerEntry.findMany({
      where: { transactionId },
      include: { wallet: { select: { id: true, walletType: true, userId: true } } },
    });
  }
}
