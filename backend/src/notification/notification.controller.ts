import { Body, Controller, Get, MessageEvent, Param, Patch, Query, Sse } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Observable, Subject } from 'rxjs';
import { NotificationService } from './notification.service';

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationController {
  private readonly subjects = new Map<string, Subject<MessageEvent>>();

  constructor(private readonly notifications: NotificationService) {}

  @Get()
  getAll(@Query('userId') userId: string, @Query('unreadOnly') unreadOnly?: string) {
    return this.notifications.getMyNotifications(userId, unreadOnly === 'true');
  }

  @Patch(':id/read')
  markRead(@Query('userId') userId: string, @Param('id') id: string) {
    return this.notifications.markRead(userId, id);
  }

  @Patch(':id/dismiss')
  dismiss(@Query('userId') userId: string, @Param('id') id: string) {
    return this.notifications.dismiss(userId, id);
  }

  @Patch('all/read')
  markAllRead(@Query('userId') userId: string) {
    return this.notifications.markAllRead(userId);
  }

  @Get('preferences')
  getPreferences(@Query('userId') userId: string) {
    return this.notifications.getOrCreatePreferences(userId);
  }

  @Patch('preferences')
  updatePreferences(
    @Query('userId') userId: string,
    @Body() body: { emailEnabled?: boolean; inAppEnabled?: boolean; typeOverrides?: Record<string, boolean> },
  ) {
    return this.notifications.updatePreferences(userId, body);
  }

  @Sse('stream')
  stream(@Query('userId') userId: string): Observable<MessageEvent> {
    if (!this.subjects.has(userId)) {
      this.subjects.set(userId, new Subject<MessageEvent>());
    }
    return this.subjects.get(userId)!.asObservable();
  }
}
