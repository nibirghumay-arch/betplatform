import { Controller, Get, Post, Patch, Param, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { WalletService } from './wallet.service';
import { CreateWalletDto } from './dto/wallet.dto';

@ApiTags('Wallets')
@ApiBearerAuth()
@Controller('wallets')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  createWallet(@Body() dto: CreateWalletDto) {
    return this.walletService.createWallet(dto.userId, dto.currency);
  }

  @Get('user/:userId')
  getWallet(@Param('userId') userId: string) {
    return this.walletService.getWalletByUserId(userId);
  }

  @Get('user/:userId/balance')
  getBalance(@Param('userId') userId: string) {
    return this.walletService.getBalance(userId);
  }

  @Get(':walletId')
  getWalletById(@Param('walletId') walletId: string) {
    return this.walletService.getWalletById(walletId);
  }

  @Patch(':walletId/freeze')
  @HttpCode(HttpStatus.NO_CONTENT)
  freezeWallet(@Param('walletId') walletId: string) {
    return this.walletService.freezeWallet(walletId);
  }

  @Patch(':walletId/unfreeze')
  @HttpCode(HttpStatus.NO_CONTENT)
  unfreezeWallet(@Param('walletId') walletId: string) {
    return this.walletService.unfreezeWallet(walletId);
  }

  @Patch(':walletId/deactivate')
  @HttpCode(HttpStatus.NO_CONTENT)
  deactivateWallet(@Param('walletId') walletId: string) {
    return this.walletService.deactivateWallet(walletId);
  }
}
