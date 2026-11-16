import { IsString, IsOptional, Length } from 'class-validator';

export class CreateWalletDto {
  @IsString()
  userId: string;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;
}
