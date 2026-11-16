import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { BD_GATEWAY_PROVIDERS, BdGatewayProvider } from './bdgateway.types';

const SETTING_KEY = 'payment.bdgateway.config';
const DEFAULT_MIN_BDT = 10;
const DEFAULT_MAX_BDT = 500000;

interface StoredCredentials {
  apiKey?: string | null;
  apiSecret?: string | null;
  webhookSecret?: string | null;
}

interface StoredGatewayConfig {
  version?: number;
  enabled?: boolean;
  baseUrl?: string;
  providers?: string[];
  minDepositBdt?: number;
  maxDepositBdt?: number;
  encryptedCredentials?: StoredCredentials;
}

export interface BdGatewayRuntimeConfig {
  enabled: boolean;
  configured: boolean;
  baseUrl: string;
  apiKey: string;
  apiSecret: string;
  webhookSecret: string;
  providers: BdGatewayProvider[];
  minDepositBdt: number;
  maxDepositBdt: number;
}

@Injectable()
export class BdGatewayConfigService {
  private readonly logger = new Logger(BdGatewayConfigService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private encryptionKey(): Buffer {
    const value = this.config.get<string>('PAYMENT_CONFIG_ENCRYPTION_KEY')?.trim() ?? '';
    if (!/^[a-fA-F0-9]{64}$/.test(value)) {
      throw new ServiceUnavailableException(
        'PAYMENT_CONFIG_ENCRYPTION_KEY must be a 64-character hex-encoded 32-byte key',
      );
    }
    return Buffer.from(value, 'hex');
  }

  private encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v1', iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join('.');
  }

  private decrypt(value: string | null | undefined): string {
    if (!value) return '';
    try {
      const [version, ivText, tagText, dataText] = value.split('.');
      if (version !== 'v1' || !ivText || !tagText || dataText === undefined) {
        throw new Error('Unsupported encrypted value format');
      }
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.encryptionKey(),
        Buffer.from(ivText, 'base64'),
      );
      decipher.setAuthTag(Buffer.from(tagText, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(dataText, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      this.logger.error('Could not decrypt saved BD gateway credentials');
      throw new ServiceUnavailableException(
        'Saved gateway credentials cannot be decrypted. Check PAYMENT_CONFIG_ENCRYPTION_KEY or re-enter the merchant credentials.',
      );
    }
  }

  private async storedConfig(): Promise<StoredGatewayConfig | null> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: SETTING_KEY } });
    if (!row || typeof row.value !== 'object' || row.value === null || Array.isArray(row.value)) {
      return null;
    }
    return row.value as StoredGatewayConfig;
  }

  async getRuntimeConfig(): Promise<BdGatewayRuntimeConfig> {
    const stored = await this.storedConfig();
    const encrypted = stored?.encryptedCredentials;
    const apiKey = this.decrypt(encrypted?.apiKey) ||
      this.config.get<string>('BD_GATEWAY_API_KEY')?.trim() || '';
    const apiSecret = this.decrypt(encrypted?.apiSecret) ||
      this.config.get<string>('BD_GATEWAY_API_SECRET')?.trim() || '';
    const webhookSecret = this.decrypt(encrypted?.webhookSecret) ||
      this.config.get<string>('BD_GATEWAY_WEBHOOK_SECRET')?.trim() || '';
    const baseUrl = (stored?.baseUrl ??
      this.config.get<string>('BD_GATEWAY_URL') ?? '').trim().replace(/\/+$/, '');
    const providers = (stored?.providers ?? [...BD_GATEWAY_PROVIDERS])
      .filter((provider): provider is BdGatewayProvider =>
        (BD_GATEWAY_PROVIDERS as readonly string[]).includes(provider),
      );
    const configured = Boolean(baseUrl && apiKey && apiSecret && webhookSecret);
    const envEnabled = this.config.get<string>('BD_GATEWAY_ENABLED')?.toLowerCase();
    const enabled = typeof stored?.enabled === 'boolean'
      ? stored.enabled
      : envEnabled === 'false'
        ? false
        : configured;

    return {
      enabled,
      configured,
      baseUrl,
      apiKey,
      apiSecret,
      webhookSecret,
      providers,
      minDepositBdt: Number(stored?.minDepositBdt ?? DEFAULT_MIN_BDT),
      maxDepositBdt: Number(stored?.maxDepositBdt ?? DEFAULT_MAX_BDT),
    };
  }

  async getPublicOptions() {
    const runtime = await this.getRuntimeConfig();
    const available = runtime.enabled && runtime.configured;
    return {
      enabled: available,
      providers: available ? runtime.providers : [],
      minDepositBdt: runtime.minDepositBdt,
      maxDepositBdt: runtime.maxDepositBdt,
      currency: 'BDT',
    };
  }

  async getAdminSettings() {
    const runtime = await this.getRuntimeConfig();
    const stored = await this.storedConfig();
    const apiPublicUrl = (this.config.get<string>('API_PUBLIC_URL') ?? '').replace(/\/+$/, '');
    const apiKey = runtime.apiKey;
    return {
      enabled: runtime.enabled,
      configured: runtime.configured,
      baseUrl: runtime.baseUrl,
      providers: runtime.providers,
      minDepositBdt: runtime.minDepositBdt,
      maxDepositBdt: runtime.maxDepositBdt,
      hasApiKey: Boolean(apiKey),
      apiKeyHint: apiKey ? `••••${apiKey.slice(-4)}` : '',
      hasApiSecret: Boolean(runtime.apiSecret),
      hasWebhookSecret: Boolean(runtime.webhookSecret),
      encryptionReady: /^[a-fA-F0-9]{64}$/.test(
        this.config.get<string>('PAYMENT_CONFIG_ENCRYPTION_KEY')?.trim() ?? '',
      ),
      credentialsStoredEncrypted: Boolean(stored?.encryptedCredentials?.apiKey),
      source: stored ? 'database' : 'environment',
      webhookUrl: apiPublicUrl
        ? `${apiPublicUrl}/payment/deposit/bdgateway/webhook`
        : null,
      gatewayAdminUrl: runtime.baseUrl ? `${runtime.baseUrl}/admin/login` : null,
      currency: 'BDT',
    };
  }

  async saveAdminSettings(input: Record<string, unknown>, updatedBy: string) {
    const current = await this.getRuntimeConfig();
    const stored = await this.storedConfig();
    const enabled = input.enabled;
    const baseUrlInput = input.baseUrl;
    const providersInput = input.providers;
    const minInput = input.minDepositBdt;
    const maxInput = input.maxDepositBdt;

    if (typeof enabled !== 'boolean') {
      throw new BadRequestException('enabled must be true or false');
    }
    if (typeof baseUrlInput !== 'string' || !baseUrlInput.trim()) {
      throw new BadRequestException('Gateway base URL is required');
    }
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(baseUrlInput.trim());
    } catch {
      throw new BadRequestException('Enter a valid gateway URL');
    }
    if (!['https:', 'http:'].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) {
      throw new BadRequestException('Gateway URL must be an HTTP(S) URL without embedded credentials');
    }
    if (this.config.get<string>('NODE_ENV') === 'production' && parsedUrl.protocol !== 'https:') {
      throw new BadRequestException('HTTPS is required for the payment gateway in production');
    }

    if (!Array.isArray(providersInput) ||
      providersInput.some((provider) =>
        typeof provider !== 'string' ||
        !(BD_GATEWAY_PROVIDERS as readonly string[]).includes(provider),
      )) {
      throw new BadRequestException('Choose one or more supported providers: BKASH, NAGAD, ROCKET, UPAY');
    }
    const providers = [...new Set(providersInput as BdGatewayProvider[])];

    const minDepositBdt = Number(minInput);
    const maxDepositBdt = Number(maxInput);
    if (!Number.isFinite(minDepositBdt) || minDepositBdt < 10 || minDepositBdt > 500000) {
      throw new BadRequestException('Minimum deposit must be between BDT 10 and BDT 500,000');
    }
    if (!Number.isFinite(maxDepositBdt) || maxDepositBdt < minDepositBdt || maxDepositBdt > 500000) {
      throw new BadRequestException('Maximum deposit must be at least the minimum and no more than BDT 500,000');
    }

    const readSecret = (key: string, existing: string): string => {
      const supplied = input[key];
      if (supplied === undefined || supplied === null || supplied === '') return existing;
      if (typeof supplied !== 'string' || supplied.trim().length < 8 || supplied.length > 512) {
        throw new BadRequestException(`${key} is invalid`);
      }
      return supplied.trim();
    };

    const apiKey = readSecret('apiKey', current.apiKey);
    const apiSecret = readSecret('apiSecret', current.apiSecret);
    const webhookSecret = readSecret('webhookSecret', current.webhookSecret);
    const configured = Boolean(baseUrlInput.trim() && apiKey && apiSecret && webhookSecret);

    if (enabled && (!configured || providers.length === 0)) {
      throw new BadRequestException(
        'To enable the gateway, configure the base URL, API key, API secret, webhook secret, and at least one provider',
      );
    }

    const encryptionKeyReady = /^[a-fA-F0-9]{64}$/.test(
      this.config.get<string>('PAYMENT_CONFIG_ENCRYPTION_KEY')?.trim() ?? '',
    );
    const encryptIfChanged = (key: string, secret: string): string | null => {
      const supplied = input[key];
      if (typeof supplied === 'string' && supplied.trim()) return this.encrypt(secret);
      return stored?.encryptedCredentials?.[key as keyof StoredCredentials] ?? null;
    };

    // New credentials are encrypted using AES-256-GCM before they enter the
    // database. Existing environment-based credentials remain environment-only.
    if (
      (typeof input.apiKey === 'string' && input.apiKey.trim() ||
       typeof input.apiSecret === 'string' && input.apiSecret.trim() ||
       typeof input.webhookSecret === 'string' && input.webhookSecret.trim()) &&
      !encryptionKeyReady
    ) {
      throw new BadRequestException(
        'Set PAYMENT_CONFIG_ENCRYPTION_KEY on the backend before saving new gateway secrets',
      );
    }

    const encryptedCredentials: StoredCredentials = {
      apiKey: encryptIfChanged('apiKey', apiKey),
      apiSecret: encryptIfChanged('apiSecret', apiSecret),
      webhookSecret: encryptIfChanged('webhookSecret', webhookSecret),
    };

    await this.prisma.systemSetting.upsert({
      where: { key: SETTING_KEY },
      update: {
        value: {
          version: 1,
          enabled,
          baseUrl: parsedUrl.toString().replace(/\/+$/, ''),
          providers,
          minDepositBdt,
          maxDepositBdt,
          encryptedCredentials,
        } as any,
        updatedBy,
      },
      create: {
        key: SETTING_KEY,
        value: {
          version: 1,
          enabled,
          baseUrl: parsedUrl.toString().replace(/\/+$/, ''),
          providers,
          minDepositBdt,
          maxDepositBdt,
          encryptedCredentials,
        } as any,
        updatedBy,
      },
    });

    this.logger.log(`BD gateway settings saved by admin ${updatedBy}; enabled=${enabled}`);
    return this.getAdminSettings();
  }
}
