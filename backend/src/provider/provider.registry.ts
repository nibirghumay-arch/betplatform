import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ProviderAdapter } from './interfaces/provider-adapter.interface';

@Injectable()
export class ProviderRegistry {
  private readonly logger = new Logger(ProviderRegistry.name);
  private readonly adapters = new Map<string, ProviderAdapter>();

  register(adapter: ProviderAdapter): void {
    if (this.adapters.has(adapter.providerId)) {
      this.logger.warn(`Provider '${adapter.providerId}' is already registered — overwriting`);
    }
    this.adapters.set(adapter.providerId, adapter);
    this.logger.log(`Registered provider: ${adapter.providerId} (${adapter.displayName})`);
  }

  get(providerId: string): ProviderAdapter {
    const adapter = this.adapters.get(providerId);
    if (!adapter) {
      throw new NotFoundException(
        `Provider '${providerId}' is not registered. Available: [${this.listIds().join(', ')}]`,
      );
    }
    return adapter;
  }

  has(providerId: string): boolean {
    return this.adapters.has(providerId);
  }

  getAll(): ProviderAdapter[] {
    return [...this.adapters.values()];
  }

  listIds(): string[] {
    return [...this.adapters.keys()];
  }
}
