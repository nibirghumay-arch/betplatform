import {
  IsString,
  IsOptional,
  IsNumberString,
  IsBoolean,
  IsObject,
  Length,
  IsNotEmpty,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class AuthenticatePlayerDto {
  @IsString()
  userId: string;

  @IsString()
  @IsNotEmpty()
  token: string;
}

export class CreateSessionDto {
  @IsString()
  userId: string;

  @IsString()
  gameId: string;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;
}

export class LaunchGameDto {
  @IsString()
  sessionId: string;
}

export class ProcessBetDto {
  @IsString()
  sessionId: string;

  @IsString()
  roundId: string;

  @IsNumberString()
  amount: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class ProcessWinDto {
  @IsString()
  sessionId: string;

  @IsString()
  roundId: string;

  @IsNumberString()
  amount: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class RefundRoundDto {
  @IsString()
  sessionId: string;

  @IsString()
  roundId: string;

  @IsNumberString()
  amount: string;
}

export class UpdateGameDto {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class GameCatalogQueryDto {
  @IsOptional()
  @IsString()
  categorySlug?: string;

  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  isActive?: boolean;
}
