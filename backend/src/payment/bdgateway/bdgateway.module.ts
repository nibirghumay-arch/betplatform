import { Module } from '@nestjs/common';
import { BdGatewayService } from './bdgateway.service';

// Client only — the webhook controller lives in PaymentModule (it needs
// DepositService), exactly like DepositController does for SSLCommerz.
@Module({
  providers: [BdGatewayService],
  exports: [BdGatewayService],
})
export class BdGatewayModule {}
