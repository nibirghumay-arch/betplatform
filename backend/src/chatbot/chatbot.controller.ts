import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { ChatbotMessageDto } from './dto/chatbot-message.dto';
import { ChatbotService } from './chatbot.service';

@ApiTags('Customer Support Chatbot')
@Controller('chatbot')
export class ChatbotController {
  constructor(private readonly chatbot: ChatbotService) {}

  @Public()
  @Post('message')
  @HttpCode(HttpStatus.OK)
  message(@Body() dto: ChatbotMessageDto, @Req() request: Request) {
    return this.chatbot.reply(dto.message, dto.history ?? [], request.ip ?? 'unknown');
  }
}
