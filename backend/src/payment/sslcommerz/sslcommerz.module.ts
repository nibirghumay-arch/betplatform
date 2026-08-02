import { Module } from '@nestjs/common';
import { SslCommerzClientService } from './sslcommerz-client.service';
import { SslcommerzService } from './sslcommerz.service';

@Module({
  providers: [SslCommerzClientService, SslcommerzService],
  exports: [SslcommerzService],
})
export class SslcommerzModule {}
