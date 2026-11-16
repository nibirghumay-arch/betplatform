// Wire types for the self-hosted BD Payment Gateway.

export const BD_GATEWAY_PROVIDERS = ['BKASH', 'NAGAD', 'ROCKET', 'UPAY'] as const;
export type BdGatewayProvider = (typeof BD_GATEWAY_PROVIDERS)[number];

export type BdGatewayOrderStatus =
  | 'PENDING'
  | 'SUBMITTED'
  | 'MATCHED'
  | 'APPROVED'
  | 'REJECTED'
  | 'EXPIRED';

export interface BdGatewayCreateOrderParams {
  amountBdt: number;
  provider: BdGatewayProvider;
  returnUrl?: string;
  metadata?: Record<string, unknown>;
  expiresInMinutes?: number;
}

export interface BdGatewayOrder {
  reference: string;
  status: BdGatewayOrderStatus;
  amountBdt: number;
  provider: BdGatewayProvider;
  receivingNumber: string;
  checkoutUrl: string;
  expiresAt: string;
}

export interface BdGatewayOrderDetail {
  reference: string;
  status: BdGatewayOrderStatus;
  amountBdt: number;
  currency: string;
  provider: BdGatewayProvider;
  receivingNumber: string;
  expiresAt: string;
  returnUrl: string | null;
  id?: string;
  submittedTrxId?: string | null;
  customerMsisdn?: string | null;
  metadata?: Record<string, unknown> | null;
  approvedAt?: string | null;
  createdAt?: string;
}

export type BdGatewayEvent = 'order.approved' | 'order.rejected' | 'order.expired';

export interface BdGatewayWebhookPayload {
  event: BdGatewayEvent;
  reference: string;
  status: BdGatewayOrderStatus;
  amountBdt: number;
  currency: string;
  provider: BdGatewayProvider;
  trxId: string | null;
  customerMsisdn: string | null;
  receivingNumber: string;
  metadata: Record<string, unknown> | null;
  approvedAt: string | null;
  createdAt: string;
}
