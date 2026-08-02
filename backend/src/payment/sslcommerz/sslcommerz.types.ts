/**
 * Types for the SSLCommerz Gateway integration (API v4).
 * Field names intentionally mirror SSLCommerz's own documented parameter
 * names (snake_case) since these cross the wire to/from their servers —
 * see https://developer.sslcommerz.com/doc/v4/
 */

/** What our own app needs to build an SSLCommerz session; separate from the
 * raw wire format so callers don't have to know SSLCommerz's field names. */
export interface SslInitiateSessionParams {
  /** Our own idempotent transaction id — becomes SSLCommerz's tran_id. */
  tranId: string;
  /** Amount in the smallest-unit-free decimal form, e.g. 100.50 */
  totalAmount: number;
  currency: string;
  successUrl: string;
  failUrl: string;
  cancelUrl: string;
  ipnUrl: string;
  customer: {
    name: string;
    email: string;
    phone: string;
    address1?: string;
    city?: string;
    postcode?: string;
    country?: string;
  };
  productName?: string;
  productCategory?: string;
  productProfile?: string;
  shippingMethod?: string;
  numOfItem?: number;
  /** Restrict checkout to a single mobile-wallet gateway, e.g. "bkash",
   * "nagad", "rocket", "upay", "mcash", "tap". Omit to show all methods. */
  restrictToGateway?: string;
  /** Free-form values echoed back verbatim on success/fail/cancel/IPN —
   * we use value_a to carry our internal depositId. */
  valueA?: string;
  valueB?: string;
  valueC?: string;
  valueD?: string;
}

/** Raw POST body SSLCommerz's gwprocess/v4/api.php expects. */
export interface SslApiInitPayload {
  store_id: string;
  store_passwd: string;
  total_amount: string;
  currency: string;
  tran_id: string;
  success_url: string;
  fail_url: string;
  cancel_url: string;
  ipn_url?: string;
  multi_card_name?: string;
  cus_name: string;
  cus_email: string;
  cus_add1: string;
  cus_city: string;
  cus_postcode: string;
  cus_country: string;
  cus_phone: string;
  shipping_method: string;
  num_of_item: string;
  product_name: string;
  product_category: string;
  product_profile: string;
  value_a?: string;
  value_b?: string;
  value_c?: string;
  value_d?: string;
  emi_option: string;
}

export interface SslApiInitResponse {
  status: 'SUCCESS' | 'FAILED';
  failedreason?: string;
  sessionkey?: string;
  GatewayPageURL?: string;
  storeBanner?: string;
  storeLogo?: string;
  desc?: Array<{ gw: string; name: string; type: string; logo: string; gw_fee?: string }>;
  is_direct_pay_enable?: string;
}

/**
 * Fields SSLCommerz posts back on success_url / fail_url / cancel_url
 * (browser redirect, application/x-www-form-urlencoded) and on the IPN URL
 * (server-to-server, same shape). These values are NOT trustworthy on their
 * own — always confirm with validate() before crediting a wallet.
 */
export interface SslCallbackBody {
  tran_id: string;
  val_id?: string;
  amount?: string;
  store_amount?: string;
  currency?: string;
  bank_tran_id?: string;
  status: 'VALID' | 'VALIDATED' | 'FAILED' | 'CANCELLED' | 'UNATTEMPTED' | 'EXPIRED' | string;
  tran_date?: string;
  error?: string;
  card_type?: string;
  card_no?: string;
  card_issuer?: string;
  card_brand?: string;
  card_issuer_country?: string;
  currency_type?: string;
  currency_amount?: string;
  value_a?: string;
  value_b?: string;
  value_c?: string;
  value_d?: string;
  verify_sign?: string;
  verify_key?: string;
  risk_level?: string;
  risk_title?: string;
}

/** Response from the Order Validation API (validator/api/validationserverAPI.php). */
export interface SslValidationResponse {
  status: 'VALID' | 'VALIDATED' | 'INVALID_TRANSACTION' | 'FAILED' | 'EXPIRED' | string;
  tran_date?: string;
  tran_id: string;
  val_id: string;
  amount: string;
  store_amount?: string;
  bank_tran_id?: string;
  card_type?: string;
  card_no?: string;
  card_issuer?: string;
  card_brand?: string;
  currency_type?: string;
  currency_amount?: string;
  currency_rate?: string;
  base_fair?: string;
  value_a?: string;
  value_b?: string;
  value_c?: string;
  value_d?: string;
  risk_level?: string;
  risk_title?: string;
}

export interface SslRefundInitiateResponse {
  APIConnect: string;
  bank_tran_id?: string;
  trans_id?: string;
  refund_ref_id?: string;
  status: 'success' | 'failed' | 'processing';
  errorReason?: string;
}

export interface SslRefundQueryResponse {
  APIConnect: string;
  refund_ref_id: string;
  bank_tran_id?: string;
  status: string;
  initiated_on?: string;
  refunded_on?: string;
}
