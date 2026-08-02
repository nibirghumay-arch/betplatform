import { Module } from '@nestjs/common';
import { BonusService } from './bonus.service';
import { BonusRuleEngine } from './bonus-rule.engine';
import { BonusUserController, BonusAdminController } from './bonus.controller';
import { TransactionModule } from '../transaction/transaction.module';

@Module({
  imports: [TransactionModule],
  providers: [BonusService, BonusRuleEngine],
  controllers: [BonusUserController, BonusAdminController],
  exports: [BonusService],
})
export class BonusModule {}
