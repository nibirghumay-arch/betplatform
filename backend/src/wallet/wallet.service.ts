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

  async createWallet(userId: string, currency = 'USD'): Promise<WalletSummary> {
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
