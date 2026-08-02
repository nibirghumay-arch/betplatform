import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { TransactionService, TransactionResult } from '../transaction/transaction.service';
import { WalletService } from '../wallet/wallet.service';

export type GameEventType = 'BET' | 'WIN' | 'REFUND' | 'CANCEL';

export interface GameEvent {
  eventType: GameEventType;
  userId: string;
  gameRoundId: string;
  amount: string;
  currency?: string;
  metadata?: Record<string, unknown>;
}

export interface GameEventResult {
  success: boolean;
  transactionId?: string;
  balance?: string;
  currency?: string;
  reference?: string;
  error?: string;
}

@Injectable()
export class GameEventService {
  private readonly logger = new Logger(GameEventService.name);

  constructor(
    private readonly transactionService: TransactionService,
    private readonly walletService: WalletService,
  ) {}

  /**
   * Central handler for all game events from the game provider.
   * Each event maps to a TransactionService operation.
   */
  async handleEvent(event: GameEvent): Promise<GameEventResult> {
    this.logger.log(
      `GameEvent: type=${event.eventType} user=${event.userId} round=${event.gameRoundId} amount=${event.amount}`,
    );

    try {
      let result: TransactionResult;

      switch (event.eventType) {
        case 'BET':
          result = await this.transactionService.bet({
            userId: event.userId,
            amount: event.amount,
            gameRoundId: event.gameRoundId,
            reference: `bet:${event.gameRoundId}`,
            metadata: event.metadata,
          });
          break;

        case 'WIN':
          result = await this.transactionService.win({
            userId: event.userId,
            amount: event.amount,
            gameRoundId: event.gameRoundId,
            reference: `win:${event.gameRoundId}`,
            metadata: event.metadata,
          });
          break;

        case 'REFUND':
        case 'CANCEL':
          result = await this.transactionService.refund({
            userId: event.userId,
            amount: event.amount,
            gameRoundId: event.gameRoundId,
            reference: `refund:${event.gameRoundId}`,
            description: event.eventType === 'CANCEL' ? 'Round cancelled' : 'Round refunded',
          });
          break;

        default:
          throw new BadRequestException(`Unknown game event type: ${(event as any).eventType}`);
      }

      return {
        success: true,
        transactionId: result.transactionId,
        balance: result.balance,
        currency: result.currency,
        reference: result.reference,
      };
    } catch (error) {
      if (error instanceof ConflictException) {
        // Idempotent: same event delivered twice — return success without re-processing.
        this.logger.warn(
          `Duplicate game event ignored: type=${event.eventType} round=${event.gameRoundId}`,
        );
        return { success: true, error: 'already_processed' };
      }
      this.logger.error(
        `GameEvent failed: type=${event.eventType} round=${event.gameRoundId} — ${error.message}`,
      );
      return { success: false, error: error.message };
    }
  }

  /**
   * Retrieve the current balance for a user — used by game providers to check funds before a round.
   */
  async getBalance(userId: string): Promise<{ balance: string; currency: string }> {
    const result = await this.walletService.getBalance(userId);
    return { balance: result.balance, currency: result.currency };
  }

  /**
   * Validate that the user has sufficient balance for a planned bet.
   * Called by game providers before presenting the spin/play button.
   */
  async canAffordBet(userId: string, betAmount: string): Promise<boolean> {
    try {
      const { balance } = await this.walletService.getBalance(userId);
      const Decimal = (await import('decimal.js')).default;
      return new Decimal(balance).greaterThanOrEqualTo(new Decimal(betAmount));
    } catch {
      return false;
    }
  }
}
