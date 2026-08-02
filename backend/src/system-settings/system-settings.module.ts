import { Global, Module } from '@nestjs/common';
import { SystemSettingsService } from './system-settings.service';

@Global()
@Module({
  providers: [SystemSettingsService],
  exports: [SystemSettingsService],
})
export class SystemSettingsModule {}
