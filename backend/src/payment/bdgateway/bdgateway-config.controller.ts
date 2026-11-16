import {
  Body,
  Controller,
  Get,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AdminRoleGuard } from '../../auth/guards/admin-role.guard';
import { BdGatewayConfigService } from './bdgateway-config.service';
import { UpdateBdGatewaySettingsDto } from './bdgateway-config.dto';

interface RequestWithUser extends Request {
  user: { userId: string; role: string };
}

@ApiTags('Payment – BD Gateway')
@ApiBearerAuth()
@Controller('payment/bdgateway')
export class BdGatewayOptionsController {
  constructor(private readonly config: BdGatewayConfigService) {}

  @Get('options')
  getOptions() {
    return this.config.getPublicOptions();
  }
}

@ApiTags('Admin – BD Gateway')
@ApiBearerAuth()
@UseGuards(AdminRoleGuard)
@Controller('admin/payment/bdgateway')
export class BdGatewayAdminController {
  constructor(private readonly config: BdGatewayConfigService) {}

  @Get()
  getSettings() {
    return this.config.getAdminSettings();
  }

  @Put()
  updateSettings(
    @Body() dto: UpdateBdGatewaySettingsDto,
    @Req() request: RequestWithUser,
  ) {
    return this.config.saveAdminSettings(dto, request.user.userId);
  }
}
