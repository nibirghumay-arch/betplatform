import { Module } from '@nestjs/common';
import { VipService } from './vip.service';

@Module({
  providers: [VipService],
  exports: [VipService],
})
export class VipModule {}
