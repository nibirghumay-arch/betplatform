import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { WalletType } from '@prisma/client';
import Decimal from 'decimal.js';
import { WalletService } from './wallet.service';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';

// ─── Mock factories ───────────────────────────────────────────────────────────

function buildPrismaMock() {
  return {
    wallet: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  } as unknown as PrismaService;
}

function buildLedgerMock() {
  return {
    getBalance: jest.fn(),
    getBalanceWithLock: jest.fn(),
  } as unknown as LedgerService;
}

const WALLET_STUB = {
  id: 'wallet-abc',
  userId: 'user-1',
  currency: 'USD',
  walletType: WalletType.USER,
  isActive: true,
  isFrozen: false,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('WalletService', () => {
  let service: WalletService;
  let prisma: ReturnType<typeof buildPrismaMock>;
  let ledger: ReturnType<typeof buildLedgerMock>;

  beforeEach(async () => {
    prisma = buildPrismaMock();
    ledger = buildLedgerMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletService,
        { provide: PrismaService, useValue: prisma },
        { provide: LedgerService, useValue: ledger },
      ],
    }).compile();

    service = module.get(WalletService);
  });

  // ─── createWallet ───────────────────────────────────────────────────────────

  describe('createWallet', () => {
    it('creates and returns a new wallet', async () => {
      (prisma.wallet.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.wallet.create as jest.Mock).mockResolvedValue(WALLET_STUB);

      const result = await service.createWallet('user-1');

      expect(prisma.wallet.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'user-1', walletType: WalletType.USER }),
        }),
      );
      expect(result.id).toBe('wallet-abc');
    });

    it('throws ConflictException when a wallet already exists for the user', async () => {
      (prisma.wallet.findUnique as jest.Mock).mockResolvedValue({ id: 'existing' });
      await expect(service.createWallet('user-1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('defaults currency to USD', async () => {
      (prisma.wallet.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.wallet.create as jest.Mock).mockResolvedValue({ ...WALLET_STUB, currency: 'USD' });

      await service.createWallet('user-1');

      expect(prisma.wallet.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ currency: 'USD' }),
        }),
      );
    });
  });

  // ─── getWalletByUserId ──────────────────────────────────────────────────────

  describe('getWalletByUserId', () => {
    it('returns wallet for a valid userId', async () => {
      (prisma.wallet.findUnique as jest.Mock).mockResolvedValue(WALLET_STUB);
      const result = await service.getWalletByUserId('user-1');
      expect(result.id).toBe('wallet-abc');
    });

    it('throws NotFoundException when wallet does not exist', async () => {
      (prisma.wallet.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.getWalletByUserId('user-missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ─── getWalletById ──────────────────────────────────────────────────────────

  describe('getWalletById', () => {
    it('returns wallet for a valid walletId', async () => {
      (prisma.wallet.findUnique as jest.Mock).mockResolvedValue(WALLET_STUB);
      const result = await service.getWalletById('wallet-abc');
      expect(result.userId).toBe('user-1');
    });

    it('throws NotFoundException for unknown walletId', async () => {
      (prisma.wallet.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.getWalletById('bad-id')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ─── getBalance ─────────────────────────────────────────────────────────────

  describe('getBalance', () => {
    it('returns formatted balance with currency and walletId', async () => {
      (prisma.wallet.findUnique as jest.Mock).mockResolvedValue(WALLET_STUB);
      (ledger.getBalance as jest.Mock).mockResolvedValue(new Decimal('123.456'));

      const result = await service.getBalance('user-1');

      expect(result.walletId).toBe('wallet-abc');
      expect(result.balance).toBe('123.46');
      expect(result.currency).toBe('USD');
    });
  });

  // ─── validateSufficientFunds ────────────────────────────────────────────────

  describe('validateSufficientFunds', () => {
    const tx = {} as any;

    it('does not throw when balance equals amount', async () => {
      (ledger.getBalanceWithLock as jest.Mock).mockResolvedValue(new Decimal('100'));
      await expect(
        service.validateSufficientFunds('wallet-abc', new Decimal('100'), tx),
      ).resolves.toBeUndefined();
    });

    it('does not throw when balance exceeds amount', async () => {
      (ledger.getBalanceWithLock as jest.Mock).mockResolvedValue(new Decimal('200'));
      await expect(
        service.validateSufficientFunds('wallet-abc', new Decimal('50'), tx),
      ).resolves.toBeUndefined();
    });

    it('throws BadRequestException when balance is insufficient', async () => {
      (ledger.getBalanceWithLock as jest.Mock).mockResolvedValue(new Decimal('10'));
      await expect(
        service.validateSufficientFunds('wallet-abc', new Decimal('50'), tx),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('includes balance and required amount in the error message', async () => {
      (ledger.getBalanceWithLock as jest.Mock).mockResolvedValue(new Decimal('5'));
      try {
        await service.validateSufficientFunds('wallet-abc', new Decimal('50'), tx);
        fail('should have thrown');
      } catch (e) {
        expect((e as BadRequestException).message).toContain('5.00');
        expect((e as BadRequestException).message).toContain('50.00');
      }
    });
  });

  // ─── assertWalletActive ─────────────────────────────────────────────────────

  describe('assertWalletActive', () => {
    it('does not throw for an active, unfrozen wallet', async () => {
      (prisma.wallet.findUnique as jest.Mock).mockResolvedValue({ isActive: true, isFrozen: false });
      await expect(service.assertWalletActive('wallet-abc')).resolves.toBeUndefined();
    });

    it('throws BadRequestException when wallet is frozen', async () => {
      (prisma.wallet.findUnique as jest.Mock).mockResolvedValue({ isActive: true, isFrozen: true });
      await expect(service.assertWalletActive('wallet-abc')).rejects.toMatchObject({
        message: 'Wallet is frozen',
      });
    });

    it('throws BadRequestException when wallet is deactivated', async () => {
      (prisma.wallet.findUnique as jest.Mock).mockResolvedValue({ isActive: false, isFrozen: false });
      await expect(service.assertWalletActive('wallet-abc')).rejects.toMatchObject({
        message: 'Wallet is deactivated',
      });
    });

    it('throws NotFoundException when wallet does not exist', async () => {
      (prisma.wallet.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.assertWalletActive('ghost-wallet')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ─── freezeWallet / unfreezeWallet ──────────────────────────────────────────

  describe('freezeWallet', () => {
    it('updates isFrozen to true', async () => {
      (prisma.wallet.update as jest.Mock).mockResolvedValue({});
      await service.freezeWallet('wallet-abc');
      expect(prisma.wallet.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isFrozen: true } }),
      );
    });
  });

  describe('unfreezeWallet', () => {
    it('updates isFrozen to false', async () => {
      (prisma.wallet.update as jest.Mock).mockResolvedValue({});
      await service.unfreezeWallet('wallet-abc');
      expect(prisma.wallet.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isFrozen: false } }),
      );
    });
  });

  // ─── getOrCreateSystemWallet ─────────────────────────────────────────────────

  describe('getOrCreateSystemWallet', () => {
    it('returns existing system wallet id if found in DB', async () => {
      (prisma.wallet.findFirst as jest.Mock).mockResolvedValue({ id: 'sys-wallet-1' });
      const id = await service.getOrCreateSystemWallet(WalletType.SYSTEM);
      expect(id).toBe('sys-wallet-1');
      expect(prisma.wallet.create).not.toHaveBeenCalled();
    });

    it('creates and returns a new system wallet if none exists', async () => {
      (prisma.wallet.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.wallet.create as jest.Mock).mockResolvedValue({ id: 'new-sys-wallet' });

      const id = await service.getOrCreateSystemWallet(WalletType.SYSTEM);
      expect(id).toBe('new-sys-wallet');
      expect(prisma.wallet.create).toHaveBeenCalled();
    });

    it('returns cached id on a second call without hitting the DB again', async () => {
      (prisma.wallet.findFirst as jest.Mock).mockResolvedValue({ id: 'house-wallet-1' });

      const first = await service.getOrCreateSystemWallet(WalletType.HOUSE);
      const second = await service.getOrCreateSystemWallet(WalletType.HOUSE);

      expect(first).toBe('house-wallet-1');
      expect(second).toBe('house-wallet-1');
      // DB only queried on the first call
      expect(prisma.wallet.findFirst).toHaveBeenCalledTimes(1);
    });

    it('keeps separate cache entries per type', async () => {
      (prisma.wallet.findFirst as jest.Mock)
        .mockResolvedValueOnce({ id: 'system-w' })
        .mockResolvedValueOnce({ id: 'house-w' });

      const sysId = await service.getOrCreateSystemWallet(WalletType.SYSTEM);
      const houseId = await service.getOrCreateSystemWallet(WalletType.HOUSE);

      expect(sysId).toBe('system-w');
      expect(houseId).toBe('house-w');
    });
  });
});
