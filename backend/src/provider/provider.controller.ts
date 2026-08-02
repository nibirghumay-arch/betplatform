import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  DefaultValuePipe,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ProviderRegistry } from './provider.registry';
import {
  AuthenticatePlayerDto,
  CreateSessionDto,
  ProcessBetDto,
  ProcessWinDto,
  RefundRoundDto,
  GameCatalogQueryDto,
  UpdateGameDto,
} from './dto/provider.dto';

@ApiTags('Game Providers')
@Controller('provider')
export class ProviderController {
  constructor(private readonly registry: ProviderRegistry) {}

  // ─── Discovery ─────────────────────────────────────────────────────────────

  @Get()
  listProviders() {
    return this.registry.getAll().map((a) => ({
      providerId: a.providerId,
      displayName: a.displayName,
    }));
  }

  // ─── Auth + Session ────────────────────────────────────────────────────────

  @Post(':providerId/auth')
  @HttpCode(HttpStatus.OK)
  authenticatePlayer(
    @Param('providerId') providerId: string,
    @Body() dto: AuthenticatePlayerDto,
  ) {
    return this.registry.get(providerId).authenticatePlayer(dto.userId, dto.token);
  }

  @Post(':providerId/sessions')
  @HttpCode(HttpStatus.CREATED)
  createSession(
    @Param('providerId') providerId: string,
    @Body() dto: CreateSessionDto,
  ) {
    return this.registry.get(providerId).createSession(dto.userId, dto.gameId, dto.currency);
  }

  @Post(':providerId/sessions/:sessionId/launch')
  @HttpCode(HttpStatus.OK)
  launchGame(
    @Param('providerId') providerId: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.registry.get(providerId).launchGame(sessionId);
  }

  // ─── Balance ───────────────────────────────────────────────────────────────

  @Get(':providerId/balance/:userId')
  syncBalance(
    @Param('providerId') providerId: string,
    @Param('userId') userId: string,
  ) {
    return this.registry.get(providerId).syncBalance(userId);
  }

  // ─── Game events (postMessage relay) ───────────────────────────────────────

  @Post(':providerId/events/bet')
  @HttpCode(HttpStatus.OK)
  processBet(
    @Param('providerId') providerId: string,
    @Body() dto: ProcessBetDto,
  ) {
    return this.registry.get(providerId).processBet({
      sessionId: dto.sessionId,
      roundId: dto.roundId,
      amount: dto.amount,
      metadata: dto.metadata,
    });
  }

  @Post(':providerId/events/win')
  @HttpCode(HttpStatus.OK)
  processWin(
    @Param('providerId') providerId: string,
    @Body() dto: ProcessWinDto,
  ) {
    return this.registry.get(providerId).processWin({
      sessionId: dto.sessionId,
      roundId: dto.roundId,
      amount: dto.amount,
      metadata: dto.metadata,
    });
  }

  @Post(':providerId/events/refund')
  @HttpCode(HttpStatus.OK)
  refundRound(
    @Param('providerId') providerId: string,
    @Body() dto: RefundRoundDto,
  ) {
    return this.registry.get(providerId).refundRound({
      sessionId: dto.sessionId,
      roundId: dto.roundId,
      amount: dto.amount,
    });
  }

  // ─── Catalog ───────────────────────────────────────────────────────────────

  @Get(':providerId/games')
  getGameCatalog(
    @Param('providerId') providerId: string,
    @Query() query: GameCatalogQueryDto,
  ) {
    return this.registry.get(providerId).getGameCatalog({
      categorySlug: query.categorySlug,
      isActive: query.isActive,
    });
  }

  @Get(':providerId/games/categories')
  getGameCategories(@Param('providerId') providerId: string) {
    return this.registry.get(providerId).getGameCategories();
  }

  @Patch(':providerId/games/:gameId')
  @HttpCode(HttpStatus.OK)
  updateGame(
    @Param('providerId') providerId: string,
    @Param('gameId') gameId: string,
    @Body() dto: UpdateGameDto,
  ) {
    return this.registry.get(providerId).updateGame(gameId, dto);
  }
}
