import { Module } from '@nestjs/common';
import { GameEventService } from './game-event.service';
import { TransactionModule } from '../transaction/transaction.module';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [TransactionModule, WalletModule],
  providers: [GameEventService],
  exports: [GameEventService],
})
export class GamesModule {}
