import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { TransactionType, TransactionStatus, WalletType } from '@prisma/client';
import Decimal from 'decimal.js';
import { TransactionService } from './transaction.service';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { WalletService } from '../wallet/wallet.service';

// ─── Shared stubs ─────────────────────────────────────────────────────────────

const USER_WALLET = {
  id: 'user-wallet-id',
  userId: 'user-1',
  currency: 'USD',
  walletType: WalletType.USER,
  isActive: true,
  isFrozen: false,
};

const TX_RECORD = {
  id: 'tx-id',
  type: TransactionType.DEPOSIT,
  status: TransactionStatus.COMPLETED,
};

// ─── Mock factories ───────────────────────────────────────────────────────────

function buildPrismaMock() {
  const txClient = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: USER_WALLET.id }]),
    transaction: {
      create: jest.fn().mockResolvedValue(TX_RECORD),
      update: jest.fn().mockResolvedValue(TX_RECORD),
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    ledgerEntry: {
      createMany: jest.fn().mockResolvedValue({ count: 2 }),
    },
    wallet: {
      findUnique: jest.fn(),
    },
  };

  return {
    $transaction: jest.fn().mockImplementation((fn: (tx: any) => Promise<any>) => fn(txClient)),
    transaction: {
      findUnique: jest.fn().mockResolvedValue(null), // for assertReferenceUnique
      findMany: jest.fn().mockResolvedValue([]),
    },
    _txClient: txClient,
  } as unknown as PrismaService & { _txClient: typeof txClient };
}

function buildLedgerMock() {
  return {
    getBalance: jest.fn().mockResolvedValue(new Decimal('100')),
    getBalanceWithLock: jest.fn().mockResolvedValue(new Decimal('100')),
    createDoubleEntry: jest.fn().mockResolvedValue(undefined),
  } as unknown as LedgerService;
}

function buildWalletMock() {
  return {
    getWalletByUserId: jest.fn().mockResolvedValue(USER_WALLET),
    assertWalletActive: jest.fn().mockResolvedValue(undefined),
    getOrCreateSystemWallet: jest.fn().mockResolvedValue('system-wallet-id'),
    validateSufficientFunds: jest.fn().mockResolvedValue(undefined),
  } as unknown as WalletService;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('TransactionService', () => {
  let service: TransactionService;
  let prisma: ReturnType<typeof buildPrismaMock>;
  let ledger: ReturnType<typeof buildLedgerMock>;
  let wallet: ReturnType<typeof buildWalletMock>;

  beforeEach(async () => {
    prisma = buildPrismaMock();
    ledger = buildLedgerMock();
    wallet = buildWalletMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionService,
        { provide: PrismaService, useValue: prisma },
        { provide: LedgerService, useValue: ledger },
        { provide: WalletService, useValue: wallet },
      ],
    }).compile();

    service = module.get(TransactionService);
  });

  // Helper to get the tx client used inside $transaction
  function getTxClient() {
    return (prisma as any)._txClient;
  }

  // ─── DEPOSIT ───────────────────────────────────────────────────────────────

  describe('deposit', () => {
    it('creates a transaction with DEPOSIT type and COMPLETED status', async () => {
      getTxClient().transaction.create.mockResolvedValue({ ...TX_RECORD, type: TransactionType.DEPOSIT });
      getTxClient().transaction.update.mockResolvedValue({ ...TX_RECORD, type: TransactionType.DEPOSIT, status: TransactionStatus.COMPLETED });

      const result = await service.deposit({ userId: 'user-1', amount: '100' });

      expect(result.type).toBe(TransactionType.DEPOSIT);
      expect(result.status).toBe(TransactionStatus.COMPLETED);
    });

    it('calls ledger.createDoubleEntry with system as debit and user as credit', async () => {
      (wallet.getOrCreateSystemWallet as jest.Mock).mockResolvedValue('system-w');
      await service.deposit({ userId: 'user-1', amount: '50' });

      expect(ledger.createDoubleEntry).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          debitWalletId: 'system-w',
          creditWalletId: USER_WALLET.id,
        }),
      );
    });

    it('returns the post-deposit balance', async () => {
      (ledger.getBalanceWithLock as jest.Mock).mockResolvedValue(new Decimal('150'));
      const result = await service.deposit({ userId: 'user-1', amount: '50' });
      expect(result.balance).toBe('150.00');
    });

    it('uses the provided reference for idempotency', async () => {
      (prisma.transaction.findUnique as jest.Mock).mockResolvedValue(null);
      const result = await service.deposit({ userId: 'user-1', amount: '10', reference: 'my-ref' });
      expect(result.reference).toBe('my-ref');
    });

    it('throws ConflictException on duplicate reference', async () => {
      (prisma.transaction.findUnique as jest.Mock).mockResolvedValue({ id: 'old-tx' });
      await expect(
        service.deposit({ userId: 'user-1', amount: '50', reference: 'dup-ref' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws BadRequestException for zero amount', async () => {
      await expect(service.deposit({ userId: 'user-1', amount: '0' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('throws BadRequestException for negative amount', async () => {
      await expect(service.deposit({ userId: 'user-1', amount: '-10' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('throws BadRequestException for amount with more than 8 decimal places', async () => {
      await expect(
        service.deposit({ userId: 'user-1', amount: '1.123456789' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // ─── WITHDRAW ──────────────────────────────────────────────────────────────

  describe('withdraw', () => {
    it('creates a transaction with WITHDRAWAL type', async () => {
      getTxClient().transaction.create.mockResolvedValue({ ...TX_RECORD, type: TransactionType.WITHDRAWAL });
      getTxClient().transaction.update.mockResolvedValue({ ...TX_RECORD, type: TransactionType.WITHDRAWAL, status: TransactionStatus.COMPLETED });

      const result = await service.withdraw({ userId: 'user-1', amount: '30' });
      expect(result.type).toBe(TransactionType.WITHDRAWAL);
    });

    it('calls ledger.createDoubleEntry with user as debit and system as credit', async () => {
      (wallet.getOrCreateSystemWallet as jest.Mock).mockResolvedValue('system-w');
      await service.withdraw({ userId: 'user-1', amount: '30' });

      expect(ledger.createDoubleEntry).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          debitWalletId: USER_WALLET.id,
          creditWalletId: 'system-w',
        }),
      );
    });

    it('calls validateSufficientFunds before writing entries', async () => {
      await service.withdraw({ userId: 'user-1', amount: '30' });
      expect(wallet.validateSufficientFunds).toHaveBeenCalledWith(
        USER_WALLET.id,
        expect.any(Decimal),
        expect.anything(),
      );
    });

    it('propagates BadRequestException from validateSufficientFunds', async () => {
      (wallet.validateSufficientFunds as jest.Mock).mockRejectedValue(
        new BadRequestException('Insufficient funds'),
      );
      await expect(service.withdraw({ userId: 'user-1', amount: '9999' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  // ─── BET ───────────────────────────────────────────────────────────────────

  describe('bet', () => {
    it('creates a transaction with BET type referencing the game round', async () => {
      getTxClient().transaction.create.mockResolvedValue({ ...TX_RECORD, type: TransactionType.BET });
      getTxClient().transaction.update.mockResolvedValue({ ...TX_RECORD, type: TransactionType.BET, status: TransactionStatus.COMPLETED });

      const result = await service.bet({ userId: 'user-1', amount: '20', gameRoundId: 'round-1' });

      expect(result.type).toBe(TransactionType.BET);
      expect(result.reference).toBe('bet:round-1');
    });

    it('debits user wallet and credits house wallet', async () => {
      (wallet.getOrCreateSystemWallet as jest.Mock).mockResolvedValue('house-w');
      await service.bet({ userId: 'user-1', amount: '20', gameRoundId: 'round-1' });

      expect(ledger.createDoubleEntry).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          debitWalletId: USER_WALLET.id,
          creditWalletId: 'house-w',
        }),
      );
    });

    it('uses WalletType.HOUSE as the counterparty', async () => {
      await service.bet({ userId: 'user-1', amount: '20', gameRoundId: 'round-1' });
      expect(wallet.getOrCreateSystemWallet).toHaveBeenCalledWith(WalletType.HOUSE, 'USD');
    });

    it('throws when user has insufficient funds', async () => {
      (wallet.validateSufficientFunds as jest.Mock).mockRejectedValue(
        new BadRequestException('Insufficient funds'),
      );
      await expect(
        service.bet({ userId: 'user-1', amount: '999', gameRoundId: 'round-1' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws ConflictException on duplicate round reference', async () => {
      (prisma.transaction.findUnique as jest.Mock).mockResolvedValue({ id: 'old-bet' });
      await expect(
        service.bet({ userId: 'user-1', amount: '20', gameRoundId: 'round-dup' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  // ─── WIN ───────────────────────────────────────────────────────────────────

  describe('win', () => {
    it('creates a transaction with WIN type', async () => {
      getTxClient().transaction.create.mockResolvedValue({ ...TX_RECORD, type: TransactionType.WIN });
      getTxClient().transaction.update.mockResolvedValue({ ...TX_RECORD, type: TransactionType.WIN, status: TransactionStatus.COMPLETED });

      const result = await service.win({ userId: 'user-1', amount: '75', gameRoundId: 'round-1' });
      expect(result.type).toBe(TransactionType.WIN);
      expect(result.reference).toBe('win:round-1');
    });

    it('debits house wallet and credits user wallet', async () => {
      (wallet.getOrCreateSystemWallet as jest.Mock).mockResolvedValue('house-w');
      await service.win({ userId: 'user-1', amount: '75', gameRoundId: 'round-1' });

      expect(ledger.createDoubleEntry).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          debitWalletId: 'house-w',
          creditWalletId: USER_WALLET.id,
        }),
      );
    });

    it('does not check sufficient funds (house always pays wins)', async () => {
      await service.win({ userId: 'user-1', amount: '75', gameRoundId: 'round-1' });
      expect(wallet.validateSufficientFunds).not.toHaveBeenCalled();
    });
  });

  // ─── REFUND ────────────────────────────────────────────────────────────────

  describe('refund', () => {
    it('creates a REFUND transaction and credits the user', async () => {
      getTxClient().transaction.create.mockResolvedValue({ ...TX_RECORD, type: TransactionType.REFUND });
      getTxClient().transaction.update.mockResolvedValue({ ...TX_RECORD, type: TransactionType.REFUND, status: TransactionStatus.COMPLETED });
      (wallet.getOrCreateSystemWallet as jest.Mock).mockResolvedValue('house-w');

      const result = await service.refund({ userId: 'user-1', amount: '20', gameRoundId: 'round-1' });

      expect(result.type).toBe(TransactionType.REFUND);
      expect(ledger.createDoubleEntry).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          debitWalletId: 'house-w',
          creditWalletId: USER_WALLET.id,
        }),
      );
    });

    it('derives a default reference from gameRoundId', async () => {
      const result = await service.refund({ userId: 'user-1', amount: '20', gameRoundId: 'round-42' });
      expect(result.reference).toBe('refund:round-42');
    });
  });

  // ─── BONUS_CREDIT ──────────────────────────────────────────────────────────

  describe('bonusCredit', () => {
    it('creates a BONUS_CREDIT transaction', async () => {
      getTxClient().transaction.create.mockResolvedValue({ ...TX_RECORD, type: TransactionType.BONUS_CREDIT });
      getTxClient().transaction.update.mockResolvedValue({ ...TX_RECORD, type: TransactionType.BONUS_CREDIT, status: TransactionStatus.COMPLETED });
      (wallet.getOrCreateSystemWallet as jest.Mock).mockResolvedValue('bonus-w');

      const result = await service.bonusCredit({ userId: 'user-1', amount: '10', description: 'Welcome bonus' });

      expect(result.type).toBe(TransactionType.BONUS_CREDIT);
      expect(ledger.createDoubleEntry).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          debitWalletId: 'bonus-w',
          creditWalletId: USER_WALLET.id,
        }),
      );
    });

    it('uses WalletType.BONUS_POOL as the source', async () => {
      await service.bonusCredit({ userId: 'user-1', amount: '10' });
      expect(wallet.getOrCreateSystemWallet).toHaveBeenCalledWith(WalletType.BONUS_POOL, 'USD');
    });
  });

  // ─── BONUS_DEBIT ───────────────────────────────────────────────────────────

  describe('bonusDebit', () => {
    it('creates a BONUS_DEBIT transaction and debits the user', async () => {
      getTxClient().transaction.create.mockResolvedValue({ ...TX_RECORD, type: TransactionType.BONUS_DEBIT });
      getTxClient().transaction.update.mockResolvedValue({ ...TX_RECORD, type: TransactionType.BONUS_DEBIT, status: TransactionStatus.COMPLETED });
      (wallet.getOrCreateSystemWallet as jest.Mock).mockResolvedValue('bonus-w');

      const result = await service.bonusDebit({ userId: 'user-1', amount: '5' });

      expect(result.type).toBe(TransactionType.BONUS_DEBIT);
      expect(ledger.createDoubleEntry).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          debitWalletId: USER_WALLET.id,
          creditWalletId: 'bonus-w',
        }),
      );
    });

    it('validates sufficient funds before debiting', async () => {
      await service.bonusDebit({ userId: 'user-1', amount: '5' });
      expect(wallet.validateSufficientFunds).toHaveBeenCalled();
    });

    it('throws when user has insufficient funds', async () => {
      (wallet.validateSufficientFunds as jest.Mock).mockRejectedValue(
        new BadRequestException('Insufficient funds'),
      );
      await expect(service.bonusDebit({ userId: 'user-1', amount: '9999' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  // ─── MANUAL_CREDIT ─────────────────────────────────────────────────────────

  describe('manualCredit', () => {
    it('creates a MANUAL_CREDIT transaction initiated by admin', async () => {
      getTxClient().transaction.create.mockResolvedValue({ ...TX_RECORD, type: TransactionType.MANUAL_CREDIT });
      getTxClient().transaction.update.mockResolvedValue({ ...TX_RECORD, type: TransactionType.MANUAL_CREDIT, status: TransactionStatus.COMPLETED });
      (wallet.getOrCreateSystemWallet as jest.Mock).mockResolvedValue('system-w');

      const result = await service.manualCredit({
        userId: 'user-1',
        adminId: 'admin-1',
        amount: '500',
        description: 'Goodwill credit for complaint',
      });

      expect(result.type).toBe(TransactionType.MANUAL_CREDIT);
      expect(ledger.createDoubleEntry).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          debitWalletId: 'system-w',
          creditWalletId: USER_WALLET.id,
        }),
      );
    });

    it('records initiatedBy as the adminId', async () => {
      await service.manualCredit({
        userId: 'user-1',
        adminId: 'admin-99',
        amount: '100',
        description: 'Test credit from admin',
      });

      const createCall = getTxClient().transaction.create.mock.calls[0][0];
      expect(createCall.data.initiatedBy).toBe('admin-99');
    });

    it('does not require wallet to be active (admin override)', async () => {
      // assertWalletActive is NOT called in manualCredit — admin can credit frozen wallets
      await service.manualCredit({
        userId: 'user-1',
        adminId: 'admin-1',
        amount: '50',
        description: 'Credit to frozen wallet',
      });
      expect(wallet.assertWalletActive).not.toHaveBeenCalled();
    });
  });

  // ─── MANUAL_DEBIT ──────────────────────────────────────────────────────────

  describe('manualDebit', () => {
    it('creates a MANUAL_DEBIT transaction and debits user wallet', async () => {
      getTxClient().transaction.create.mockResolvedValue({ ...TX_RECORD, type: TransactionType.MANUAL_DEBIT });
      getTxClient().transaction.update.mockResolvedValue({ ...TX_RECORD, type: TransactionType.MANUAL_DEBIT, status: TransactionStatus.COMPLETED });
      (wallet.getOrCreateSystemWallet as jest.Mock).mockResolvedValue('system-w');

      const result = await service.manualDebit({
        userId: 'user-1',
        adminId: 'admin-1',
        amount: '100',
        description: 'Chargeback adjustment',
      });

      expect(result.type).toBe(TransactionType.MANUAL_DEBIT);
      expect(ledger.createDoubleEntry).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          debitWalletId: USER_WALLET.id,
          creditWalletId: 'system-w',
        }),
      );
    });

    it('validates sufficient funds', async () => {
      await service.manualDebit({
        userId: 'user-1',
        adminId: 'admin-1',
        amount: '50',
        description: 'Chargeback',
      });
      expect(wallet.validateSufficientFunds).toHaveBeenCalled();
    });

    it('throws when user balance is insufficient', async () => {
      (wallet.validateSufficientFunds as jest.Mock).mockRejectedValue(
        new BadRequestException('Insufficient funds'),
      );
      await expect(
        service.manualDebit({
          userId: 'user-1',
          adminId: 'admin-1',
          amount: '99999',
          description: 'Chargeback',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // ─── getTransaction ─────────────────────────────────────────────────────────

  describe('getTransaction', () => {
    it('throws NotFoundException for unknown transaction id', async () => {
      (prisma.transaction as any).findUnique = jest.fn().mockResolvedValue(null);
      await expect(service.getTransaction('bad-id')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ─── validateAmount (private via public interface) ──────────────────────────

  describe('amount validation', () => {
    it.each([
      ['0', 'zero'],
      ['-1', 'negative'],
      ['1.123456789', '9 decimal places'],
    ])('rejects %s (%s)', async (amount, _label) => {
      await expect(service.deposit({ userId: 'user-1', amount })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it.each([
      ['0.00000001', '8 decimal places'],
      ['1000000', 'large integer'],
      ['99.99', '2 decimal places'],
    ])('accepts %s (%s)', async (amount, _label) => {
      // Will fail for other reasons (mock setup) but NOT BadRequestException from parseAmount
      try {
        await service.deposit({ userId: 'user-1', amount });
      } catch (e) {
        expect(e).not.toBeInstanceOf(BadRequestException);
      }
    });
  });
});
