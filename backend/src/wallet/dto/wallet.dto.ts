import { IsString, IsOptional, Length } from 'class-validator';

export class CreateWalletDto {
  @IsString()
  userId: string;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;
}

export class MigrateWalletCurrencyDto {
  @IsString()
  @Length(1, 128)
  userId: string;

  @IsString()
  @Length(1, 32)
  bdtPerUsd: string;

  @IsString()
  @Length(8, 500)
  reason: string;
}
