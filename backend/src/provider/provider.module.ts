import { Module } from '@nestjs/common';
import { ProviderRegistry } from './provider.registry';
import { ProviderController } from './provider.controller';
import { Html5GameAdapter } from './adapters/html5/html5-game.adapter';
import { WalletModule } from '../wallet/wallet.module';
import { GamesModule } from '../games/games.module';

@Module({
  imports: [
    WalletModule,
    GamesModule,
  ],
  providers: [
    ProviderRegistry,
    Html5GameAdapter,
  ],
  controllers: [ProviderController],
  exports: [ProviderRegistry],
})
export class ProviderModule {}
