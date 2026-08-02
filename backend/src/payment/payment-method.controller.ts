import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { IsString, IsNotEmpty } from 'class-validator';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { PaymentMethodService } from './payment-method.service';
import { CreatePaymentMethodDto, UpdatePaymentMethodDto } from './dto/payment-method.dto';

class UserScopedQueryDto {
  @IsString()
  @IsNotEmpty()
  userId: string;
}

@ApiTags('Payment – Saved Methods')
@ApiBearerAuth()
@Controller('payment/methods')
export class PaymentMethodController {
  constructor(private readonly paymentMethodService: PaymentMethodService) {}

  @Get()
  list(@Query() query: UserScopedQueryDto) {
    return this.paymentMethodService.listByUser(query.userId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Query() query: UserScopedQueryDto, @Body() dto: CreatePaymentMethodDto) {
    return this.paymentMethodService.create(query.userId, dto);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Query() query: UserScopedQueryDto,
    @Body() dto: UpdatePaymentMethodDto,
  ) {
    return this.paymentMethodService.update(id, query.userId, dto);
  }

  @Patch(':id/default')
  @HttpCode(HttpStatus.OK)
  setDefault(@Param('id') id: string, @Query() query: UserScopedQueryDto) {
    return this.paymentMethodService.setDefault(id, query.userId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @Query() query: UserScopedQueryDto) {
    return this.paymentMethodService.remove(id, query.userId);
  }
}
