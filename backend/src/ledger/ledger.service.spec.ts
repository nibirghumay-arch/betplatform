import { Test, TestingModule } from '@nestjs/testing';
import { LedgerService } from './ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { EntryType } from '@prisma/client';
import Decimal from 'decimal.js';

// ─── Mock factory ─────────────────────────────────────────────────────────────

function buildTxClient() {
  return {
    $queryRaw: jest.fn(),
    ledgerEntry: {
      createMany: jest.fn().mockResolvedValue({ count: 2 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
}

function buildPrismaService() {
  return {
    $queryRaw: jest.fn(),
    ledgerEntry: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  } as unknown as PrismaService;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('LedgerService', () => {
  let service: LedgerService;
  let prisma: ReturnType<typeof buildPrismaService>;

  beforeEach(async () => {
    prisma = buildPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LedgerService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(LedgerService);
  });

  // ─── getBalance ─────────────────────────────────────────────────────────────

  describe('getBalance', () => {
    it('returns a Decimal representing the computed balance', async () => {
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ balance: '250.50000000' }]);
      const result = await service.getBalance('wallet-1');
      expect(result).toBeInstanceOf(Decimal);
      expect(result.toFixed(2)).toBe('250.50');
    });

    it('returns 0 when the wallet has no ledger entries', async () => {
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ balance: '0' }]);
      const result = await service.getBalance('wallet-empty');
      expect(result.toFixed(2)).toBe('0.00');
    });

    it('returns 0 when the raw query returns an empty array', async () => {
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([]);
      const result = await service.getBalance('wallet-none');
      expect(result.toFixed(2)).toBe('0.00');
    });
  });

  // ─── getBalanceWithLock ─────────────────────────────────────────────────────

  describe('getBalanceWithLock', () => {
    it('issues a FOR UPDATE lock then returns the balance', async () => {
      const tx = buildTxClient();
      tx.$queryRaw
        .mockResolvedValueOnce([{ id: 'wallet-1' }])          // FOR UPDATE lock
        .mockResolvedValueOnce([{ balance: '100.00000000' }]); // balance query

      const result = await service.getBalanceWithLock('wallet-1', tx as any);

      expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
      expect(result.toFixed(2)).toBe('100.00');
    });

    it('returns 0 when balance row has null (no entries yet)', async () => {
      const tx = buildTxClient();
      tx.$queryRaw
        .mockResolvedValueOnce([{ id: 'wallet-1' }])
        .mockResolvedValueOnce([{ balance: '0' }]);

      const result = await service.getBalanceWithLock('wallet-1', tx as any);
      expect(result.toFixed(2)).toBe('0.00');
    });
  });

  // ─── createDoubleEntry ──────────────────────────────────────────────────────

  describe('createDoubleEntry', () => {
    const baseParams = {
      debitWalletId: 'wallet-debit',
      creditWalletId: 'wallet-credit',
      transactionId: 'tx-1',
      amount: new Decimal('50.00'),
      currency: 'USD',
      description: 'Test entry',
    };

    it('calls ledgerEntry.createMany with exactly 2 entries', async () => {
      const tx = buildTxClient();
      await service.createDoubleEntry(tx as any, baseParams);

      expect(tx.ledgerEntry.createMany).toHaveBeenCalledTimes(1);
      const { data } = (tx.ledgerEntry.createMany as jest.Mock).mock.calls[0][0];
      expect(data).toHaveLength(2);
    });

    it('creates a DEBIT entry for debitWalletId', async () => {
      const tx = buildTxClient();
      await service.createDoubleEntry(tx as any, baseParams);

      const { data } = (tx.ledgerEntry.createMany as jest.Mock).mock.calls[0][0];
      const debitEntry = data.find((e: any) => e.entryType === EntryType.DEBIT);
      expect(debitEntry).toBeDefined();
      expect(debitEntry.walletId).toBe('wallet-debit');
      expect(debitEntry.amount).toBe('50.00000000');
      expect(debitEntry.currency).toBe('USD');
    });

    it('creates a CREDIT entry for creditWalletId', async () => {
      const tx = buildTxClient();
      await service.createDoubleEntry(tx as any, baseParams);

      const { data } = (tx.ledgerEntry.createMany as jest.Mock).mock.calls[0][0];
      const creditEntry = data.find((e: any) => e.entryType === EntryType.CREDIT);
      expect(creditEntry).toBeDefined();
      expect(creditEntry.walletId).toBe('wallet-credit');
      expect(creditEntry.amount).toBe('50.00000000');
    });

    it('stores transactionId on both entries', async () => {
      const tx = buildTxClient();
      await service.createDoubleEntry(tx as any, baseParams);

      const { data } = (tx.ledgerEntry.createMany as jest.Mock).mock.calls[0][0];
      data.forEach((e: any) => expect(e.transactionId).toBe('tx-1'));
    });

    it('throws when debit and credit wallet are the same', async () => {
      const tx = buildTxClient();
      await expect(
        service.createDoubleEntry(tx as any, {
          ...baseParams,
          creditWalletId: baseParams.debitWalletId,
        }),
      ).rejects.toThrow('Debit and credit wallet must differ');
    });

    it('rounds amount to 8 decimal places', async () => {
      const tx = buildTxClient();
      await service.createDoubleEntry(tx as any, {
        ...baseParams,
        amount: new Decimal('12.123456789'), // more than 8 dp
      });

      const { data } = (tx.ledgerEntry.createMany as jest.Mock).mock.calls[0][0];
      // toDecimalPlaces(8) rounds the 9th digit
      data.forEach((e: any) => expect(e.amount).toMatch(/^\d+\.\d{8}$/));
    });
  });

  // ─── getEntriesForWallet ─────────────────────────────────────────────────────

  describe('getEntriesForWallet', () => {
    it('queries by walletId with default pagination', async () => {
      (prisma.ledgerEntry.findMany as jest.Mock).mockResolvedValue([]);
      await service.getEntriesForWallet('wallet-1');

      expect(prisma.ledgerEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { walletId: 'wallet-1' },
          skip: 0,
          take: 50,
          orderBy: { createdAt: 'desc' },
        }),
      );
    });

    it('forwards custom pagination params', async () => {
      (prisma.ledgerEntry.findMany as jest.Mock).mockResolvedValue([]);
      await service.getEntriesForWallet('wallet-1', { skip: 20, take: 10 });

      expect(prisma.ledgerEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });
  });
});
