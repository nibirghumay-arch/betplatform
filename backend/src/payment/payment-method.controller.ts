import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import type { Request } from 'express';
import { PaymentMethodService } from './payment-method.service';
import { CreatePaymentMethodDto, UpdatePaymentMethodDto } from './dto/payment-method.dto';

interface RequestWithUser extends Request {
  user: { userId: string; role: string };
}

@ApiTags('Payment – Saved Methods')
@ApiBearerAuth()
@Controller('payment/methods')
export class PaymentMethodController {
  constructor(private readonly paymentMethodService: PaymentMethodService) {}

  @Get()
  list(@Req() request: RequestWithUser) {
    return this.paymentMethodService.listByUser(request.user.userId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreatePaymentMethodDto, @Req() request: RequestWithUser) {
    return this.paymentMethodService.create(request.user.userId, dto);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePaymentMethodDto,
    @Req() request: RequestWithUser,
  ) {
    return this.paymentMethodService.update(id, request.user.userId, dto);
  }

  @Patch(':id/default')
  @HttpCode(HttpStatus.OK)
  setDefault(@Param('id') id: string, @Req() request: RequestWithUser) {
    return this.paymentMethodService.setDefault(id, request.user.userId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @Req() request: RequestWithUser) {
    return this.paymentMethodService.remove(id, request.user.userId);
  }
}
