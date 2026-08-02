import {
  IsString,
  IsOptional,
  IsNumberString,
  IsObject,
  IsNotEmpty,
  MinLength,
} from 'class-validator';

export class DepositDto {
  @IsString()
  userId: string;

  @IsNumberString()
  amount: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class WithdrawDto {
  @IsString()
  userId: string;

  @IsNumberString()
  amount: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class ManualAdjustmentDto {
  @IsString()
  userId: string;

  @IsString()
  adminId: string;

  @IsNumberString()
  amount: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(10, { message: 'description must describe the reason (min 10 chars)' })
  description: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class GetHistoryDto {
  @IsString()
  userId: string;

  @IsOptional()
  @IsString()
  type?: string;
}
