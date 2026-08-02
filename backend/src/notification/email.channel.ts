import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { NotificationChannel, NotificationPayload } from './notification-channel.interface';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class EmailChannel implements NotificationChannel {
  readonly channelName = 'email';
  private readonly logger = new Logger(EmailChannel.name);
  private transporter: nodemailer.Transporter;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.transporter = nodemailer.createTransport({
      host: this.config.get('SMTP_HOST', 'localhost'),
      port: Number(this.config.get('SMTP_PORT', '1025')),
      secure: this.config.get('SMTP_SECURE', 'false') === 'true',
      auth: this.config.get('SMTP_USER')
        ? { user: this.config.get('SMTP_USER'), pass: this.config.get('SMTP_PASS') }
        : undefined,
    });
  }

  async send(payload: NotificationPayload): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.userId },
      select: { email: true },
    });
    if (!user) return;

    const from = this.config.get('SMTP_FROM', 'noreply@platform.local');
    try {
      await this.transporter.sendMail({
        from,
        to: user.email,
        subject: payload.title,
        text: payload.body,
      });
    } catch (err) {
      this.logger.warn(`Email send failed for user ${payload.userId}: ${(err as Error).message}`);
    }
  }
}
