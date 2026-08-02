import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength } from 'class-validator';
import { ReferralService } from './referral.service';

class ApplyReferralCodeDto {
  @IsString()
  @MinLength(8)
  @MaxLength(32)
  code!: string;
}

@ApiTags('Referrals')
@ApiBearerAuth()
@Controller('referral')
export class ReferralController {
  constructor(private readonly referralService: ReferralService) {}

  @Post('generate/:userId')
  generateCode(@Param('userId') userId: string) {
    return this.referralService.generateCode(userId);
  }

  @Get('code/:userId')
  getMyCode(@Param('userId') userId: string) {
    return this.referralService.getMyCode(userId);
  }

  @Post('apply/:userId')
  applyCode(@Param('userId') userId: string, @Body() dto: ApplyReferralCodeDto) {
    return this.referralService.applyReferralCode(userId, dto.code);
  }

  @Get('list/:userId')
  getMyReferrals(
    @Param('userId') userId: string,
    @Query('skip', new DefaultValuePipe(0), ParseIntPipe) skip: number,
    @Query('take', new DefaultValuePipe(20), ParseIntPipe) take: number,
  ) {
    return this.referralService.getMyReferrals(userId, skip, take);
  }

  @Get('rewards/:userId')
  getMyRewards(
    @Param('userId') userId: string,
    @Query('skip', new DefaultValuePipe(0), ParseIntPipe) skip: number,
    @Query('take', new DefaultValuePipe(20), ParseIntPipe) take: number,
  ) {
    return this.referralService.getMyRewards(userId, skip, take);
  }
}
