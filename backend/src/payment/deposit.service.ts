import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DepositStatus } from '@prisma/client';
import Decimal from 'decimal.js';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionService } from '../transaction/transaction.service';
import { WalletService } from '../wallet/wallet.service';
import { PspSignatureService } from './psp-signature.service';
import { SslcommerzService, SupportedMobileGateway } from './sslcommerz/sslcommerz.service';
import { SslCallbackBody } from './sslcommerz/sslcommerz.types';
import { BdGatewayService } from './bdgateway/bdgateway.service';
import {
  BdGatewayOrderDetail,
  BdGatewayProvider,
  BdGatewayWebhookPayload,
} from './bdgateway/bdgateway.types';

export const SSLCOMMERZ_PROVIDER = 'sslcommerz';
/** Self-hosted bKash/Nagad/Rocket/Upay gateway (SMS-verified Send Money). */
export const BDGATEWAY_PROVIDER = 'bdgateway';

/** Human labels stored on Deposit.paymentChannel for transaction history. */
const BD_PROVIDER_LABELS: Record<BdGatewayProvider, string> = {
  BKASH: 'bKash',
  NAGAD: 'Nagad',
  ROCKET: 'Rocket',
  UPAY: 'Upay',
};

export interface InitiateDepositParams {
  userId: string;
  amount: Decimal | string | number;
  currency?: string;
  pspProvider: string;
  metadata?: Record<string, unknown>;
  /** Only used when pspProvider === 'sslcommerz'. Restricts the SSLCommerz
   * checkout page to a single mobile wallet (bKash/Nagad/Rocket/Upay/mCash/
   * Tap) instead of showing every method SSLCommerz supports. */
  mobileGateway?: SupportedMobileGateway;
  /** Only used when pspProvider === 'bdgateway'. Which of the owner's mobile
   * money accounts the customer will Send Money to. */
  bdProvider?: BdGatewayProvider;
  customer?: {
    name: string;
    email: string;
    phone: string;
  };
}

export interface InitiateDepositResult {
  depositId: string;
  checkoutUrl: string;
  expiresAt: Date;
}

@Injectable()
export class DepositService {
  private readonly logger = new Logger(DepositService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly transactionService: TransactionService,
    private readonly walletService: WalletService,
    private readonly pspSignature: PspSignatureService,
    private readonly sslcommerz: SslcommerzService,
    private readonly bdGateway: BdGatewayService,
    private readonly config: ConfigService,
  ) {}

  // ─── Initiate ───────────────────────────────────────────────────────────────

  async initiate(params: InitiateDepositParams): Promise<InitiateDepositResult> {
    const amount = this.parseAmount(params.amount);
    const currency = params.currency ?? 'USD';

    const wallet = await this.walletService.getWalletByUserId(params.userId);
    await this.walletService.assertWalletActive(wallet.id);

    const deposit = await this.prisma.deposit.create({
      data: {
        userId: params.userId,
        amount: amount.toFixed(8),
        currency,
        pspProvider: params.pspProvider,
        metadata: (params.metadata ?? null) as any,
        status: DepositStatus.PENDING_PAYMENT,
      },
    });

    if (params.pspProvider === SSLCOMMERZ_PROVIDER) {
      return this.initiateSslcommerz(deposit.id, amount, currency, params);
    }

    if (params.pspProvider === BDGATEWAY_PROVIDER) {
      return this.initiateBdGateway(deposit.id, amount, currency, params);
    }

    // Stub: in production this calls the PSP SDK (e.g. Stripe.checkout.sessions.create).
    const pspSessionId = `sess_${uuidv4()}`;
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    const checkoutUrl = `https://checkout.${params.pspProvider}.example.com/pay/${pspSessionId}?depositId=${deposit.id}`;

    await this.prisma.deposit.update({
      where: { id: deposit.id },
      data: { pspSessionId },
    });

    this.logger.log(
      `Deposit initiated: id=${deposit.id} userId=${params.userId} amount=${amount.toFixed(2)} provider=${params.pspProvider}`,
    );

    return { depositId: deposit.id, checkoutUrl, expiresAt };
  }

  // ─── SSLCommerz ──────────────────────────────────────────────────────────────

  private async initiateSslcommerz(
    depositId: string,
    amount: Decimal,
    currency: string,
    params: InitiateDepositParams,
  ): Promise<InitiateDepositResult> {
    const apiBaseUrl = this.config.get<string>('API_PUBLIC_URL') ?? 'http://localhost:3000/api/v1';

    // SSLCommerz requires this to be a stable, unique alphanumeric string —
    // we reuse our own Deposit id so success/fail/cancel/IPN callbacks can
    // resolve straight back to the row without any extra lookup table.
    const tranId = depositId;

    try {
      const session = await this.sslcommerz.createSession({
        tranId,
        totalAmount: amount.toNumber(),
        currency,
        successUrl: `${apiBaseUrl}/payment/deposit/sslcommerz/success`,
        failUrl: `${apiBaseUrl}/payment/deposit/sslcommerz/fail`,
        cancelUrl: `${apiBaseUrl}/payment/deposit/sslcommerz/cancel`,
        ipnUrl: `${apiBaseUrl}/payment/deposit/sslcommerz/ipn`,
        customer: {
          name: params.customer?.name ?? 'Platform User',
          email: params.customer?.email ?? 'noreply@betting.local',
          phone: params.customer?.phone ?? '01700000000',
        },
        productName: 'Wallet Deposit',
        productCategory: 'wallet-topup',
        restrictToGateway: params.mobileGateway,
        valueA: depositId,
      });

      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

      await this.prisma.deposit.update({
        where: { id: depositId },
        data: { pspSessionId: session.sessionKey },
      });

      this.logger.log(
        `SSLCommerz deposit initiated: id=${depositId} userId=${params.userId} amount=${amount.toFixed(2)} gateway=${params.mobileGateway ?? 'all'}`,
      );

      // The frontend simply redirects the browser to this URL — it is
      // SSLCommerz's own hosted checkout page.
      return { depositId, checkoutUrl: session.gatewayPageUrl, expiresAt };
    } catch (err) {
      await this.prisma.deposit.update({
        where: { id: depositId },
        data: { status: DepositStatus.FAILED, failureReason: (err as Error).message },
      });
      throw err;
    }
  }

  /**
   * Called by the SSLCommerz success/IPN controller endpoints after they've
   * already re-validated the transaction against SSLCommerz's own Order
   * Validation API (see SslcommerzService.validateTransaction). This method
   * assumes `body` is trustworthy — callers must validate first.
   */
  async settleSslcommerzTransaction(body: SslCallbackBody): Promise<void> {
    const depositId = body.value_a || body.tran_id;
    const amount = new Decimal(body.amount ?? '0');
    const channel = this.sslcommerz.describeChannel(body);

    const pspReference = body.val_id || body.bank_tran_id || body.tran_id;

    await this.settle(pspReference, amount, (body.currency ?? 'BDT').toUpperCase(), depositId, {
      sslValId: body.val_id,
      sslTranId: body.tran_id,
      bankTranId: body.bank_tran_id,
      paymentChannel: channel,
    });

    if (body.val_id) {
      await this.prisma.deposit.updateMany({
        where: { id: depositId },
        data: { sslValId: body.val_id, paymentChannel: channel },
      });
    }
  }

  async markSslcommerzFailed(body: SslCallbackBody, reason: string): Promise<void> {
    const depositId = body.value_a || body.tran_id;
    if (depositId) {
      await this.markFailed(depositId, reason);
    }
  }

  // ─── BD Payment Gateway (bKash / Nagad / Rocket / Upay) ─────────────────────

  private async initiateBdGateway(
    depositId: string,
    amount: Decimal,
    currency: string,
    params: InitiateDepositParams,
  ): Promise<InitiateDepositResult> {
    if (currency !== 'BDT') {
      await this.markFailed(depositId, `Gateway settles BDT only, got ${currency}`);
      throw new BadRequestException('The bKash/Nagad gateway only accepts BDT deposits');
    }

    const frontendUrl = this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3001';
    const provider = params.bdProvider ?? 'BKASH';

    try {
      const order = await this.bdGateway.createOrder({
        amountBdt: amount.toDecimalPlaces(2).toNumber(),
        provider,
        returnUrl: `${frontendUrl}/wallet/deposit/result?status=pending&depositId=${depositId}`,
        // Echoed back on the webhook — this is how we find the Deposit again.
        metadata: { depositId, userId: params.userId },
        expiresInMinutes: 30,
      });

      await this.prisma.deposit.update({
        where: { id: depositId },
        data: {
          // The gateway's order reference is our handle on the session.
          pspSessionId: order.reference,
          paymentChannel: BD_PROVIDER_LABELS[provider],
        },
      });

      this.logger.log(
        `BD gateway deposit initiated: id=${depositId} userId=${params.userId} amount=${amount.toFixed(2)} provider=${provider} ref=${order.reference}`,
      );

      return { depositId, checkoutUrl: order.checkoutUrl, expiresAt: new Date(order.expiresAt) };
    } catch (err) {
      await this.markFailed(depositId, (err as Error).message);
      throw err;
    }
  }

  /**
   * Entry point for a signature-verified gateway webhook. The body is only a
   * hint: we re-read the order from the gateway API and act on that, so a
   * forged-but-correctly-signed payload still cannot invent a payment.
   */
  async handleBdGatewayWebhook(payload: BdGatewayWebhookPayload): Promise<void> {
    if (!payload?.reference) {
      this.logger.error('BD gateway webhook carried no reference — ignoring');
      return;
    }

    const order = await this.bdGateway.getOrder(payload.reference);
    if (!order) {
      this.logger.warn(`BD gateway webhook for unknown order ${payload.reference}`);
      return;
    }

    await this.applyBdGatewayOrder(order, payload.metadata ?? null);
  }

  /** Re-check one deposit against the gateway — for late or lost webhooks. */
  async reconcileBdGatewayDeposit(
    depositId: string,
  ): Promise<{ depositId: string; status: string; gatewayStatus: string }> {
    const deposit = await this.findById(depositId);

    if (deposit.pspProvider !== BDGATEWAY_PROVIDER) {
      throw new BadRequestException(
        `Deposit ${depositId} was not created through the bKash/Nagad gateway`,
      );
    }
    if (!deposit.pspSessionId) {
      throw new BadRequestException(`Deposit ${depositId} has no gateway order attached`);
    }

    const order = await this.bdGateway.getOrder(deposit.pspSessionId);
    if (!order) {
      throw new NotFoundException(`Gateway order ${deposit.pspSessionId} no longer exists`);
    }

    await this.applyBdGatewayOrder(order, { depositId });

    const fresh = await this.prisma.deposit.findUnique({ where: { id: depositId } });
    return {
      depositId,
      status: fresh?.status ?? deposit.status,
      gatewayStatus: order.status,
    };
  }

  /** Applies whatever the gateway says the order's state is, exactly once. */
  private async applyBdGatewayOrder(
    order: BdGatewayOrderDetail,
    metadataHint: Record<string, unknown> | null,
  ): Promise<void> {
    const deposit = await this.findBdGatewayDeposit(order.reference, order.metadata ?? metadataHint);
    if (!deposit) {
      this.logger.warn(`No deposit matches gateway order ${order.reference}`);
      return;
    }

    if (order.status === 'APPROVED') {
      // The gateway only approves when a forwarded SMS matches BOTH the TrxID
      // and the exact amount, so order.amountBdt is what actually arrived.
      await this.settle(
        order.submittedTrxId || order.reference,
        new Decimal(order.amountBdt),
        (order.currency ?? 'BDT').toUpperCase(),
        deposit.id,
        {
          gatewayReference: order.reference,
          gatewayProvider: order.provider,
          trxId: order.submittedTrxId ?? null,
          customerMsisdn: order.customerMsisdn ?? null,
          receivingNumber: order.receivingNumber,
        },
      );
      return;
    }

    if (order.status === 'REJECTED' || order.status === 'EXPIRED') {
      await this.markFailed(
        deposit.id,
        order.status === 'EXPIRED'
          ? 'Gateway order expired before the payment could be verified'
          : 'Payment rejected by the gateway operator',
      );
      return;
    }

    this.logger.debug(`Gateway order ${order.reference} is still ${order.status} — nothing to do`);
  }

  private async findBdGatewayDeposit(reference: string, metadata?: Record<string, unknown> | null) {
    const hinted = typeof metadata?.depositId === 'string' ? metadata.depositId : undefined;
    if (hinted) {
      const byId = await this.prisma.deposit.findUnique({ where: { id: hinted } });
      if (byId) return byId;
    }
    return this.prisma.deposit.findFirst({
      where: { pspSessionId: reference, pspProvider: BDGATEWAY_PROVIDER },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ─── Webhook ────────────────────────────────────────────────────────────────

  async handleWebhook(
    provider: string,
    signatureHeader: string,
    rawBody: Buffer,
  ): Promise<void> {
    this.pspSignature.verify(provider, signatureHeader, rawBody);

    let event: { type: string; data: Record<string, unknown> };
    try {
      event = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new BadRequestException('Webhook body is not valid JSON');
    }

    switch (event.type) {
      case 'payment.succeeded':
      case 'checkout.session.completed':
        await this.handleSuccess(event.data);
        break;
      case 'payment.failed':
      case 'checkout.session.expired':
        await this.handleFailure(event.data);
        break;
      default:
        this.logger.debug(`Unhandled deposit webhook event type: ${event.type}`);
    }
  }

  // ─── Queries ────────────────────────────────────────────────────────────────

  async findById(depositId: string) {
    const deposit = await this.prisma.deposit.findUnique({ where: { id: depositId } });
    if (!deposit) throw new NotFoundException(`Deposit ${depositId} not found`);
    return deposit;
  }

  async listByUser(userId: string, skip = 0, take = 50) {
    return this.prisma.deposit.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
  }

  // ─── Private: event routing ─────────────────────────────────────────────────

  private async handleSuccess(data: Record<string, unknown>): Promise<void> {
    const pspReference = (data['pspReference'] ?? data['id'] ?? data['payment_intent']) as string | undefined;
    const rawAmount = data['amount'] ?? data['amount_received'];
    const currency = ((data['currency'] as string | undefined) ?? 'USD').toUpperCase();

    if (!pspReference) {
      this.logger.error(`Deposit success webhook missing pspReference: ${JSON.stringify(data)}`);
      return;
    }

    const confirmedAmount = rawAmount != null ? new Decimal(rawAmount as string | number) : null;
    const depositId = (data['depositId'] ?? (data['metadata'] as any)?.depositId) as string | undefined;
    await this.settle(pspReference, confirmedAmount, currency, depositId, data);
  }

  private async handleFailure(data: Record<string, unknown>): Promise<void> {
    const pspReference = (data['pspReference'] ?? data['id']) as string | undefined;
    const depositId = (data['depositId'] ?? (data['metadata'] as any)?.depositId) as string | undefined;
    const reason =
      ((data['failure_reason'] ?? (data['last_payment_error'] as any)?.message) as string | undefined) ??
      'PSP payment failed';

    if (depositId) {
      await this.markFailed(depositId, reason);
      return;
    }
    if (pspReference) {
      const deposit = await this.prisma.deposit.findUnique({ where: { pspReference } });
      if (deposit) await this.markFailed(deposit.id, reason);
    }
  }

  // ─── Private: settlement ────────────────────────────────────────────────────

  /**
   * Atomically claim and settle a deposit.
   * Uses updateMany with a status condition as an optimistic lock so only one
   * concurrent webhook delivery can win the race.
   */
  private async settle(
    pspReference: string,
    confirmedAmount: Decimal | null,
    currency: string,
    depositId: string | undefined,
    webhookData: Record<string, unknown>,
  ): Promise<void> {
    // Resolve deposit by our own ID (from webhook metadata) or by PSP reference.
    let deposit = depositId
      ? await this.prisma.deposit.findUnique({ where: { id: depositId } })
      : null;

    if (!deposit) {
      deposit = await this.prisma.deposit.findUnique({ where: { pspReference } });
    }

    if (!deposit) {
      this.logger.warn(`Deposit not found for pspReference=${pspReference} depositId=${depositId}`);
      return;
    }

    if (deposit.status !== DepositStatus.PENDING_PAYMENT) {
      if (deposit.status === DepositStatus.COMPLETED) {
        this.logger.debug(`Deposit ${deposit.id} already COMPLETED — skipping duplicate webhook`);
      } else {
        this.logger.warn(
          `Deposit ${deposit.id} in status ${deposit.status} — cannot settle`,
        );
      }
      return;
    }

    // Atomic claim: only one concurrent worker can flip to PROCESSING.
    const claimed = await this.prisma.deposit.updateMany({
      where: { id: deposit.id, status: DepositStatus.PENDING_PAYMENT },
      data: { status: DepositStatus.PROCESSING, pspReference },
    });

    if (claimed.count === 0) {
      this.logger.debug(`Deposit ${deposit.id} was claimed by another worker — skipping`);
      return;
    }

    const storedAmount = new Decimal(deposit.amount.toString());
    const settlementAmount = confirmedAmount ?? storedAmount;

    if (confirmedAmount && !confirmedAmount.equals(storedAmount)) {
      this.logger.warn(
        `Deposit ${deposit.id}: stored ${storedAmount.toFixed(2)} vs PSP-confirmed ${confirmedAmount.toFixed(2)} — settling with PSP amount`,
      );
    }

    try {
      const txResult = await this.transactionService.deposit({
        userId: deposit.userId,
        amount: settlementAmount,
        reference: `deposit:${deposit.id}`,
        description: `Deposit via ${deposit.pspProvider}`,
        metadata: { depositId: deposit.id, pspReference, ...webhookData },
      });

      await this.prisma.deposit.update({
        where: { id: deposit.id },
        data: {
          status: DepositStatus.COMPLETED,
          pspReference,
          pspAmount: settlementAmount.toFixed(8),
          transactionId: txResult.transactionId,
        },
      });

      this.logger.log(
        `Deposit settled: id=${deposit.id} userId=${deposit.userId} amount=${settlementAmount.toFixed(2)} txId=${txResult.transactionId}`,
      );
    } catch (err) {
      await this.prisma.deposit.update({
        where: { id: deposit.id },
        data: { status: DepositStatus.FAILED, failureReason: (err as Error).message },
      });
      this.logger.error(
        `Deposit settlement failed: id=${deposit.id} error=${(err as Error).message}`,
      );
    }
  }

  private async markFailed(depositId: string, reason: string): Promise<void> {
    await this.prisma.deposit.updateMany({
      where: {
        id: depositId,
        status: { notIn: [DepositStatus.COMPLETED, DepositStatus.FAILED, DepositStatus.CANCELLED] },
      },
      data: { status: DepositStatus.FAILED, failureReason: reason },
    });
    this.logger.log(`Deposit failed: id=${depositId} reason=${reason}`);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private parseAmount(raw: Decimal | string | number): Decimal {
    const amount = new Decimal(raw);
    if (amount.lessThanOrEqualTo(0)) throw new BadRequestException('Amount must be greater than zero');
    if (amount.decimalPlaces() > 8) throw new BadRequestException('Amount must not exceed 8 decimal places');
    return amount;
  }
}
