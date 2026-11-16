import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { BD_GATEWAY_PROVIDERS, BdGatewayProvider } from './bdgateway.types';

export class UpdateBdGatewaySettingsDto {
  @IsBoolean()
  enabled!: boolean;

  @IsString()
  @MinLength(8)
  baseUrl!: string;

  @IsArray()
  @ArrayMaxSize(4)
  @IsIn(BD_GATEWAY_PROVIDERS, { each: true })
  providers!: BdGatewayProvider[];

  @Type(() => Number)
  @IsNumber()
  @Min(10)
  @Max(500000)
  minDepositBdt!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(10)
  @Max(500000)
  maxDepositBdt!: number;

  @IsOptional()
  @IsString()
  apiKey?: string;

  @IsOptional()
  @IsString()
  apiSecret?: string;

  @IsOptional()
  @IsString()
  webhookSecret?: string;
}
