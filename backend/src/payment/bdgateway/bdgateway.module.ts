import { Module } from '@nestjs/common';
import { BdGatewayService } from './bdgateway.service';
import { BdGatewayConfigService } from './bdgateway-config.service';

@Module({
  providers: [BdGatewayConfigService, BdGatewayService],
  exports: [BdGatewayConfigService, BdGatewayService],
})
export class BdGatewayModule {}
