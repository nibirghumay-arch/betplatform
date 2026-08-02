import { IsString, IsOptional, IsNotEmpty } from 'class-validator';

/**
 * DTO for the form-urlencoded body SSLCommerz POSTs to success_url / fail_url
 * / cancel_url / ipn_url.
 *
 * This MUST be a decorated class, not a plain interface: main.ts registers a
 * global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })`,
 * which strips (and, with forbidNonWhitelisted, rejects) any field it can't
 * see validation metadata for. An interface carries no runtime metadata, so
 * every field SSLCommerz sends would be treated as unrecognized and the
 * whole callback would 400. Every field below is optional except tran_id and
 * status, since SSLCommerz omits different fields depending on payment
 * channel and outcome (e.g. a CANCELLED callback has no val_id/amount).
 */
export class SslCommerzCallbackDto {
  @IsString()
  @IsNotEmpty()
  tran_id: string;

  @IsString()
  @IsNotEmpty()
  status: string;

  @IsOptional()
  @IsString()
  val_id?: string;

  @IsOptional()
  @IsString()
  amount?: string;

  @IsOptional()
  @IsString()
  store_amount?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  bank_tran_id?: string;

  @IsOptional()
  @IsString()
  tran_date?: string;

  @IsOptional()
  @IsString()
  error?: string;

  @IsOptional()
  @IsString()
  card_type?: string;

  @IsOptional()
  @IsString()
  card_no?: string;

  @IsOptional()
  @IsString()
  card_issuer?: string;

  @IsOptional()
  @IsString()
  card_brand?: string;

  @IsOptional()
  @IsString()
  card_issuer_country?: string;

  @IsOptional()
  @IsString()
  currency_type?: string;

  @IsOptional()
  @IsString()
  currency_amount?: string;

  @IsOptional()
  @IsString()
  value_a?: string;

  @IsOptional()
  @IsString()
  value_b?: string;

  @IsOptional()
  @IsString()
  value_c?: string;

  @IsOptional()
  @IsString()
  value_d?: string;

  @IsOptional()
  @IsString()
  verify_sign?: string;

  @IsOptional()
  @IsString()
  verify_key?: string;

  @IsOptional()
  @IsString()
  risk_level?: string;

  @IsOptional()
  @IsString()
  risk_title?: string;
}
