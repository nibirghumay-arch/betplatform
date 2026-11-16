import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma, WalletType } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';

export interface WalletSummary {
  id: string;
  userId: string | null;
  currency: string;
  walletType: WalletType;
  isActive: boolean;
  isFrozen: boolean;
}

export interface BalanceResult {
  walletId: string;
  balance: string;
  currency: string;
}

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  /** In-process cache for system wallet IDs — safe because they never change. */
  private readonly systemWalletCache = new Map<string, string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  // ─── User Wallet Lifecycle ──────────────────────────────────────────────────

  async createWallet(userId: string, currency = 'BDT'): Promise<WalletSummary> {
    const existing = await this.prisma.wallet.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(`Wallet already exists for user ${userId}`);
    }

    const wallet = await this.prisma.wallet.create({
      data: { userId, currency, walletType: WalletType.USER },
      select: { id: true, userId: true, currency: true, walletType: true, isActive: true, isFrozen: true },
    });

    this.logger.log(`Wallet created: id=${wallet.id} userId=${userId} currency=${currency}`);
    return wallet;
  }

  /**
   * Admin-approved legacy currency migration. Historical USD entries remain
   * immutable and are offset to zero through a USD debit; a separate BDT
   * opening-credit transaction establishes the converted BDT balance.
   */
  async migrateUserWalletToBdt(
    userId: string,
    adminId: string,
    bdtPerUsd: string,
    reason: string,
  ): Promise<{ walletId: string; previousCurrency: string; newCurrency: string; previousBalance: string; newBalance: string }> {
    const rate = new Decimal(bdtPerUsd);
    if (!rate.isFinite() || rate.lte(0) || rate.gt(100000)) {
      throw new BadRequestException('Enter a valid BDT-per-USD exchange rate');
    }
    const note = reason.trim();
    if (note.length < 8 || note.length > 500) {
      throw new BadRequestException('Provide an audit reason between 8 and 500 characters');
    }

    const wallet = await this.getWalletByUserId(userId);
    if (wallet.currency === 'BDT') {
      throw new ConflictException('This wallet is already denominated in BDT');
    }
    if (wallet.currency !== 'USD') {
      throw new BadRequestException(`Only USD wallets can be migrated to BDT; found ${wallet.currency}`);
    }

    const usdSystemWalletId = await this.getOrCreateSystemWallet('SYSTEM', 'USD');
    const bdtSystemWalletId = await this.getOrCreateSystemWallet('SYSTEM', 'BDT');
    const reference = `currency-migration:${wallet.id}`;

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM wallets WHERE id = ${wallet.id} FOR UPDATE`;
      const current = await tx.wallet.findUnique({ where: { id: wallet.id } });
      if (!current || current.currency !== 'USD') {
        throw new ConflictException('Wallet currency changed; refresh and retry');
      }
      const prior = await tx.ledgerEntry.count({ where: { walletId: wallet.id } });
      const existingMigration = await tx.transaction.findFirst({
        where: { reference },
        select: { id: true },
      });
      if (existingMigration) throw new ConflictException('A currency migration was already recorded');

      const balance = await this.ledger.getBalanceWithLock(wallet.id, tx);
      if (balance.isNegative()) {
        throw new BadRequestException('Negative USD balances require manual accounting review before migration');
      }
      const converted = balance.mul(rate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      const metadata = {
        action: 'ADMIN_APPROVED_CURRENCY_MIGRATION',
        userId,
        adminId,
        from: 'USD',
        to: 'BDT',
        bdtPerUsd: rate.toString(),
        reason: note,
        historicalLedgerEntries: prior,
        previousBalanceUsd: balance.toFixed(8),
        convertedBalanceBdt: converted.toFixed(2),
      };

      if (balance.gt(0)) {
        const usdTx = await tx.transaction.create({
          data: {
            type: 'MANUAL_DEBIT',
            status: 'COMPLETED',
            amount: balance.toFixed(8),
            currency: 'USD',
            reference: `${reference}:usd-close`,
            description: 'USD balance closed for approved BDT wallet migration',
            metadata: metadata as any,
            initiatedBy: adminId,
          },
        });
        await this.ledger.createDoubleEntry(tx, {
          debitWalletId: wallet.id,
          creditWalletId: usdSystemWalletId,
          transactionId: usdTx.id,
          amount: balance,
          currency: 'USD',
          description: 'Close legacy USD balance during currency migration',
        });

        if (converted.gt(0)) {
          const bdtTx = await tx.transaction.create({
            data: {
              type: 'MANUAL_CREDIT',
              status: 'COMPLETED',
              amount: converted.toFixed(2),
              currency: 'BDT',
              reference: `${reference}:bdt-open`,
              description: 'Converted opening BDT balance from approved USD migration',
              metadata: metadata as any,
              initiatedBy: adminId,
            },
          });
          await this.ledger.createDoubleEntry(tx, {
            debitWalletId: bdtSystemWalletId,
            creditWalletId: wallet.id,
            transactionId: bdtTx.id,
            amount: converted,
            currency: 'BDT',
            description: 'Open converted BDT balance during currency migration',
          });
        }
      }

      if (balance.isZero()) {
        await tx.transaction.create({
          data: {
            type: 'MANUAL_CREDIT',
            status: 'COMPLETED',
            amount: '0',
            currency: 'BDT',
            reference: `${reference}:zero-balance-audit`,
            description: 'Approved USD to BDT currency migration with zero opening balance',
            metadata: metadata as any,
            initiatedBy: adminId,
          },
        });
      }

      await tx.wallet.update({ where: { id: wallet.id }, data: { currency: 'BDT' } });
      return {
        walletId: wallet.id,
        previousCurrency: 'USD',
        newCurrency: 'BDT',
        previousBalance: balance.toFixed(2),
        newBalance: converted.toFixed(2),
      };
    });
  }

  async getWalletByUserId(userId: string): Promise<WalletSummary> {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
      select: { id: true, userId: true, currency: true, walletType: true, isActive: true, isFrozen: true },
    });
    if (!wallet) throw new NotFoundException(`Wallet not found for user ${userId}`);
    return wallet;
  }

  async getWalletById(walletId: string): Promise<WalletSummary> {
    const wallet = await this.prisma.wallet.findUnique({
      where: { id: walletId },
      select: { id: true, userId: true, currency: true, walletType: true, isActive: true, isFrozen: true },
    });
    if (!wallet) throw new NotFoundException(`Wallet ${walletId} not found`);
    return wallet;
  }

  // ─── Balance ────────────────────────────────────────────────────────────────

  async getBalance(userId: string): Promise<BalanceResult> {
    const wallet = await this.getWalletByUserId(userId);
    const balance = await this.ledger.getBalance(wallet.id);
    return { walletId: wallet.id, balance: balance.toFixed(2), currency: wallet.currency };
  }

  /**
   * Acquire a row-lock on `walletId` and throw if balance < `amount`.
   * Must be called inside a Prisma interactive transaction.
   */
  async validateSufficientFunds(
    walletId: string,
    amount: Decimal,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const balance = await this.ledger.getBalanceWithLock(walletId, tx);
    if (balance.lessThan(amount)) {
      throw new BadRequestException(
        `Insufficient funds: balance ${balance.toFixed(2)}, required ${amount.toFixed(2)}`,
      );
    }
  }

  // ─── Wallet Status ──────────────────────────────────────────────────────────

  /**
   * Assert wallet is active and not frozen.
   * Accepts an optional transaction client for use inside a $transaction block.
   */
  async assertWalletActive(
    walletId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    const wallet = await client.wallet.findUnique({
      where: { id: walletId },
      select: { isActive: true, isFrozen: true },
    });
    if (!wallet) throw new NotFoundException(`Wallet ${walletId} not found`);
    if (!wallet.isActive) throw new BadRequestException('Wallet is deactivated');
    if (wallet.isFrozen) throw new BadRequestException('Wallet is frozen');
  }

  async freezeWallet(walletId: string): Promise<void> {
    await this.prisma.wallet.update({ where: { id: walletId }, data: { isFrozen: true } });
    this.logger.warn(`Wallet frozen: ${walletId}`);
  }

  async unfreezeWallet(walletId: string): Promise<void> {
    await this.prisma.wallet.update({ where: { id: walletId }, data: { isFrozen: false } });
    this.logger.log(`Wallet unfrozen: ${walletId}`);
  }

  async deactivateWallet(walletId: string): Promise<void> {
    await this.prisma.wallet.update({ where: { id: walletId }, data: { isActive: false } });
    this.logger.warn(`Wallet deactivated: ${walletId}`);
  }

  // ─── System / House / Bonus Wallets ────────────────────────────────────────

  /**
   * Return the ID of the singleton system wallet for the given type + currency.
   * Creates the wallet on first call; subsequent calls return the cached ID.
   * System wallets have no `userId`.
   */
  async getOrCreateSystemWallet(
    type: 'SYSTEM' | 'HOUSE' | 'BONUS_POOL',
    currency = 'USD',
  ): Promise<string> {
    const cacheKey = `${type}:${currency}`;
    const cached = this.systemWalletCache.get(cacheKey);
    if (cached) return cached;

    let wallet = await this.prisma.wallet.findFirst({
      where: { walletType: type, currency },
      select: { id: true },
    });

    if (!wallet) {
      wallet = await this.prisma.wallet.create({
        data: { walletType: type, currency },
        select: { id: true },
      });
      this.logger.log(`System wallet created: type=${type} currency=${currency} id=${wallet.id}`);
    }

    this.systemWalletCache.set(cacheKey, wallet.id);
    return wallet.id;
  }
}
