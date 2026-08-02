export interface NotificationPayload {
  userId: string;
  type: string;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
}

export interface NotificationChannel {
  readonly channelName: string;
  send(payload: NotificationPayload): Promise<void>;
}
