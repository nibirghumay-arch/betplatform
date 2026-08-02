import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsEnum, IsObject, IsOptional, IsInt, Min, IsISO8601, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';
import { BonusType } from '@prisma/client';
import { BonusService } from './bonus.service';

class CreateBonusRuleDto {
  @IsString()
  name!: string;

  @IsEnum(BonusType)
  bonusType!: BonusType;

  @IsString()
  triggerEvent!: string;

  @IsObject()
  config!: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;

  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  @IsOptional()
  @IsISO8601()
  endsAt?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxClaimsPerUser?: number;
}

class ForfeitBonusDto {
  @IsString()
  adminId!: string;
}

@ApiTags('Bonuses')
@ApiBearerAuth()
@Controller('bonus')
export class BonusUserController {
  constructor(private readonly bonusService: BonusService) {}

  @Get(':userId')
  getUserBonuses(
    @Param('userId') userId: string,
    @Query('skip', new DefaultValuePipe(0), ParseIntPipe) skip: number,
    @Query('take', new DefaultValuePipe(20), ParseIntPipe) take: number,
  ) {
    return this.bonusService.getUserBonuses(userId, skip, take);
  }

  @Get(':userId/active')
  getActiveBonus(@Param('userId') userId: string) {
    return this.bonusService.getActiveBonus(userId);
  }
}

@ApiTags('Admin – Bonuses')
@ApiBearerAuth()
@Controller('admin/bonus')
export class BonusAdminController {
  constructor(private readonly bonusService: BonusService) {}

  @Get('rules')
  getRules(
    @Query('skip', new DefaultValuePipe(0), ParseIntPipe) skip: number,
    @Query('take', new DefaultValuePipe(50), ParseIntPipe) take: number,
  ) {
    return this.bonusService.getAdminBonusRules(skip, take);
  }

  @Post('rules')
  createRule(@Body() dto: CreateBonusRuleDto) {
    return this.bonusService.createBonusRule({
      ...dto,
      startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
      endsAt: dto.endsAt ? new Date(dto.endsAt) : undefined,
    });
  }

  @Post('rules/:id/activate')
  activate(@Param('id') id: string) {
    return this.bonusService.toggleBonusRule(id, true);
  }

  @Post('rules/:id/deactivate')
  deactivate(@Param('id') id: string) {
    return this.bonusService.toggleBonusRule(id, false);
  }

  @Post(':id/forfeit')
  forfeit(@Param('id') id: string, @Body() dto: ForfeitBonusDto) {
    return this.bonusService.forfeit(id, dto.adminId);
  }

  @Post('expire')
  expireOverdue() {
    return this.bonusService.expireOverdueBonuses();
  }
}
