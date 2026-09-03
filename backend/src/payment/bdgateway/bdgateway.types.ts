// ============================================================
// Wire types for the self-hosted BD Payment Gateway
// (bKash / Nagad / Rocket / Upay, verified from forwarded SMS).
//
// Field names mirror the gateway's JSON exactly — see its
// app/api/orders/route.ts and lib/webhook.ts.
// ============================================================

/** Mobile-money providers the gateway can accept a Send Money to. */
export const BD_GATEWAY_PROVIDERS = ['BKASH', 'NAGAD', 'ROCKET', 'UPAY'] as const;
export type BdGatewayProvider = (typeof BD_GATEWAY_PROVIDERS)[number];

/** Gateway order lifecycle. */
export type BdGatewayOrderStatus =
  | 'PENDING'
  | 'AWAITING_MATCH'
  | 'APPROVED'
  | 'REJECTED'
  | 'EXPIRED';

export interface BdGatewayCreateOrderParams {
  amountBdt: number;
  provider: BdGatewayProvider;
  /** Where the gateway's checkout page sends the customer once it resolves. */
  returnUrl?: string;
  /** Echoed back verbatim on the webhook — we put `{ depositId }` here. */
  metadata?: Record<string, unknown>;
  expiresInMinutes?: number;
}

export interface BdGatewayOrder {
  reference: string;
  status: BdGatewayOrderStatus;
  amountBdt: number;
  provider: BdGatewayProvider;
  /** The number the customer must Send Money to. */
  receivingNumber: string;
  checkoutUrl: string;
  expiresAt: string;
}

/** Authenticated (merchant) view of GET /api/orders/:reference. */
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

/** Body of POST /payment/deposit/bdgateway/webhook. */
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
