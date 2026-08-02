import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsBoolean,
  Length,
  Matches,
} from 'class-validator';
import { PaymentMethodType } from '@prisma/client';

// Bangladeshi mobile numbers: 11 digits starting with 01 (matches bKash/Nagad/
// Rocket/Upay/mCash/Tap account number formats — all are phone-number-keyed).
const BD_MOBILE_REGEX = /^01[3-9]\d{8}$/;

export class CreatePaymentMethodDto {
  @IsEnum(PaymentMethodType)
  type: PaymentMethodType;

  @IsString()
  @IsNotEmpty()
  @Length(4, 34)
  accountNumber: string;

  @IsOptional()
  @IsString()
  accountHolder?: string;

  @IsOptional()
  @IsString()
  bankName?: string;

  @IsOptional()
  @IsString()
  branchName?: string;

  @IsOptional()
  @IsString()
  routingNumber?: string;

  @IsOptional()
  @IsString()
  @Length(0, 40)
  label?: string;

  /** If true (or if this is the user's first saved method), it becomes the
   * default/active method and any previous default is demoted. */
  @IsOptional()
  @IsBoolean()
  makeDefault?: boolean;
}

export class UpdatePaymentMethodDto {
  @IsOptional()
  @IsString()
  accountHolder?: string;

  @IsOptional()
  @IsString()
  bankName?: string;

  @IsOptional()
  @IsString()
  branchName?: string;

  @IsOptional()
  @IsString()
  routingNumber?: string;

  @IsOptional()
  @IsString()
  @Length(0, 40)
  label?: string;
}

/** Validates that mobile-wallet account numbers (bKash/Nagad/Rocket/Upay/
 * mCash/Tap) look like a BD phone number. Kept separate from the DTO's
 * class-validator decorators since the required format depends on `type`,
 * which class-validator can't express declaratively without a custom
 * validator class — checked explicitly in the service instead. */
export function isValidMobileAccountNumber(accountNumber: string): boolean {
  return BD_MOBILE_REGEX.test(accountNumber);
}

export const MOBILE_WALLET_TYPES: PaymentMethodType[] = [
  PaymentMethodType.BKASH,
  PaymentMethodType.NAGAD,
  PaymentMethodType.ROCKET,
  PaymentMethodType.UPAY,
  PaymentMethodType.MCASH,
  PaymentMethodType.TAP,
];
