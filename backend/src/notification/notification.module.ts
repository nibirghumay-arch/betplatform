import { Module, OnModuleInit } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { NotificationController } from './notification.controller';
import { EmailChannel } from './email.channel';

@Module({
  providers: [NotificationService, EmailChannel],
  controllers: [NotificationController],
  exports: [NotificationService],
})
export class NotificationModule implements OnModuleInit {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly emailChannel: EmailChannel,
  ) {}

  onModuleInit() {
    this.notificationService.registerChannel(this.emailChannel);
  }
}
