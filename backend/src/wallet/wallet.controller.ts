import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Req,
  HttpCode,
  HttpStatus,
  NotFoundException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import type { Request } from 'express';
import { AdminRoleGuard } from '../auth/guards/admin-role.guard';
import { WalletService } from './wallet.service';
import { CreateWalletDto } from './dto/wallet.dto';

interface RequestWithUser extends Request {
  user: { userId: string; role: string };
}

@ApiTags('Wallets')
@ApiBearerAuth()
@Controller('wallets')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Post()
  @UseGuards(AdminRoleGuard)
  @HttpCode(HttpStatus.CREATED)
  createWallet(@Body() dto: CreateWalletDto) {
    return this.walletService.createWallet(dto.userId, dto.currency);
  }

  @Get('user/:userId')
  getWallet(@Req() request: RequestWithUser) {
    return this.walletService.getWalletByUserId(request.user.userId);
  }

  @Get('user/:userId/balance')
  getBalance(@Req() request: RequestWithUser) {
    return this.walletService.getBalance(request.user.userId);
  }

  @Get(':walletId')
  @UseGuards(AdminRoleGuard)
  getWalletById(@Param('walletId') walletId: string) {
    return this.walletService.getWalletById(walletId);
  }

  @Patch(':walletId/freeze')
  @UseGuards(AdminRoleGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  freezeWallet(@Param('walletId') walletId: string) {
    return this.walletService.freezeWallet(walletId);
  }

  @Patch(':walletId/unfreeze')
  @UseGuards(AdminRoleGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  unfreezeWallet(@Param('walletId') walletId: string) {
    return this.walletService.unfreezeWallet(walletId);
  }

  @Patch(':walletId/deactivate')
  @UseGuards(AdminRoleGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  deactivateWallet(@Param('walletId') walletId: string) {
    return this.walletService.deactivateWallet(walletId);
  }
}
