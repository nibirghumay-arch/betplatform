import {
  IsString,
  IsNumber,
  IsPositive,
  IsOptional,
  IsObject,
  IsEnum,
  IsEmail,
  Min,
  Max,
  IsNotEmpty,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

// Mobile wallets SSLCommerz can restrict checkout to. Kept as a plain string
// union (not PaymentMethodType) since CARD/BANK never restrict the gateway
// picker — only the mobile financial services do.
export type MobileGatewayChoice = 'BKASH' | 'NAGAD' | 'ROCKET' | 'UPAY' | 'MCASH' | 'TAP';
const MOBILE_GATEWAY_CHOICES: MobileGatewayChoice[] = [
  'BKASH',
  'NAGAD',
  'ROCKET',
  'UPAY',
  'MCASH',
  'TAP',
];

// Providers the self-hosted BD gateway can take a Send Money on. Narrower than
// the SSLCommerz list: it only supports wallets the owner holds a SIM for.
export type BdGatewayChoice = 'BKASH' | 'NAGAD' | 'ROCKET' | 'UPAY';
const BD_GATEWAY_CHOICES: BdGatewayChoice[] = ['BKASH', 'NAGAD', 'ROCKET', 'UPAY'];

export class DepositCustomerDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  phone: string;
}

export class InitiateDepositDto {
  @IsNumber()
  @IsPositive()
  amount: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsString()
  @IsNotEmpty()
  pspProvider: string;

  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  /** Only meaningful when pspProvider === 'sslcommerz'. Locks the SSLCommerz
   * checkout page to a single mobile wallet, e.g. the user picked "bKash" on
   * our deposit form. Omit to let SSLCommerz show every method it supports. */
  @IsOptional()
  @IsEnum(MOBILE_GATEWAY_CHOICES)
  mobileGateway?: MobileGatewayChoice;

  /** Only meaningful when pspProvider === 'bdgateway'. Which of the owner's
   * own mobile-money numbers the customer will Send Money to. */
  @IsOptional()
  @IsEnum(BD_GATEWAY_CHOICES)
  bdProvider?: BdGatewayChoice;

  @IsOptional()
  @ValidateNested()
  @Type(() => DepositCustomerDto)
  customer?: DepositCustomerDto;
}

export class RequestWithdrawalDto {
  @IsNumber()
  @IsPositive()
  amount: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsString()
  @IsNotEmpty()
  pspProvider: string;

  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsOptional()
  @IsObject()
  payoutDetails?: Record<string, unknown>;

  /** Saved payment method to pay out to. If omitted, the user's current
   * default payment method is used. */
  @IsOptional()
  @IsString()
  paymentMethodId?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class ApproveWithdrawalDto {
  @IsString()
  @IsNotEmpty()
  adminId: string;
}

export class RejectWithdrawalDto {
  @IsString()
  @IsNotEmpty()
  adminId: string;

  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class CancelWithdrawalDto {
  @IsString()
  @IsNotEmpty()
  userId: string;
}

export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  skip?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  take?: number;
}

export class DepositListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  userId?: string;
}
