import { Module } from '@nestjs/common';
import { PspSignatureService } from './psp-signature.service';
import { DepositService } from './deposit.service';
import { WithdrawalService } from './withdrawal.service';
import { PaymentMethodService } from './payment-method.service';
import { DepositController } from './deposit.controller';
import { WithdrawalController, WithdrawalAdminController } from './withdrawal.controller';
import { PaymentMethodController } from './payment-method.controller';
import { SslcommerzModule } from './sslcommerz/sslcommerz.module';
import { BdGatewayModule } from './bdgateway/bdgateway.module';
import { BdGatewayController } from './bdgateway/bdgateway.controller';
import { TransactionModule } from '../transaction/transaction.module';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [TransactionModule, WalletModule, SslcommerzModule, BdGatewayModule],
  providers: [PspSignatureService, DepositService, WithdrawalService, PaymentMethodService],
  controllers: [
    DepositController,
    BdGatewayController,
    WithdrawalController,
    WithdrawalAdminController,
    PaymentMethodController,
  ],
  exports: [DepositService, WithdrawalService, PaymentMethodService],
})
export class PaymentModule {}
