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
  checkoutUrl?: string;
  expiresAt: Date;
  paymentDetails?: {
    provider: BdGatewayProvider;
    receivingNumber: string;
    amountBdt: number;
    currency: 'BDT';
  };
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
    if (params.currency && params.currency.toUpperCase() !== 'BDT') {
      throw new BadRequestException('BetPlatform only supports BDT. Submit the deposit amount in Bangladeshi Taka.');
    }
    // Currency is a platform invariant, not a client-selected option.
    const currency = 'BDT';

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
          // Only the merchant order reference and public receiving instructions
          // are stored. No API key, API secret, or webhook secret is persisted
          // in a customer-visible field.
          pspSessionId: order.reference,
          paymentChannel: BD_PROVIDER_LABELS[provider],
          metadata: {
            ...(params.metadata ?? {}),
            bdGateway: {
              provider,
              receivingNumber: order.receivingNumber,
              amountBdt: order.amountBdt,
              currency: 'BDT',
              expiresAt: order.expiresAt,
            },
          } as any,
        },
      });

      this.logger.log(
        `BD gateway deposit initiated: id=${depositId} userId=${params.userId} amount=${amount.toFixed(2)} provider=${provider} ref=${order.reference}`,
      );

      // Do not send the provider's hosted checkout URL to the browser. The
      // customer completes the instructions and TrxID submission on BetPlatform.
      return {
        depositId,
        expiresAt: new Date(order.expiresAt),
        paymentDetails: {
          provider,
          receivingNumber: order.receivingNumber,
          amountBdt: order.amountBdt,
          currency: 'BDT',
        },
      };
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

  /** Customer submits a TrxID from the BetPlatform-hosted payment screen. */
  async submitBdGatewayTrx(
    depositId: string,
    userId: string,
    trxId: string,
    customerMsisdn?: string,
  ): Promise<{ status: string; message: string }> {
    const deposit = await this.findById(depositId);
    if (deposit.userId !== userId) throw new NotFoundException('Deposit not found');
    if (deposit.pspProvider !== BDGATEWAY_PROVIDER || !deposit.pspSessionId) {
      throw new BadRequestException('This deposit does not have an active BD gateway order');
    }
    if (deposit.status !== DepositStatus.PENDING_PAYMENT && deposit.status !== DepositStatus.PROCESSING) {
      throw new BadRequestException(`This deposit is already ${deposit.status.toLowerCase()}`);
    }
    if (!/^[A-Za-z0-9]{6,20}$/.test(trxId.trim())) {
      throw new BadRequestException('Enter a valid 6–20 character TrxID');
    }
    if (customerMsisdn && !/^01[3-9]\d{8}$/.test(customerMsisdn)) {
      throw new BadRequestException('Enter a valid Bangladeshi mobile number');
    }

    const customerTrxId = trxId.trim();
    await this.prisma.deposit.update({
      where: { id: depositId },
      data: {
        metadata: this.mergeBdGatewayMetadata(deposit.metadata, {
          customerTrxId,
          customerMsisdn: customerMsisdn ?? null,
          customerTrxSubmittedAt: new Date().toISOString(),
          // A new customer TrxID invalidates any previous admin SMS check.
          lastTrxCheck: null,
          adminSmsTrxId: null,
        }) as any,
      },
    });

    await this.bdGateway.submitTrxId(deposit.pspSessionId, customerTrxId, customerMsisdn);
    const order = await this.bdGateway.getOrder(deposit.pspSessionId);
    if (order) await this.applyBdGatewayOrder(order, { depositId });

    const refreshed = await this.prisma.deposit.findUnique({ where: { id: depositId } });
    return {
      status: refreshed?.status ?? 'PENDING_PAYMENT',
      message: refreshed?.status === DepositStatus.COMPLETED
        ? 'Payment verified. Your wallet has been credited.'
        : 'TrxID submitted. Your payment is being verified; this page will update automatically.',
    };
  }

  private mergeBdGatewayMetadata(
    metadata: unknown,
    bdGatewayPatch: Record<string, unknown>,
  ): Record<string, unknown> {
    const root = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? { ...(metadata as Record<string, unknown>) }
      : {};
    const existingBdGateway = root.bdGateway &&
      typeof root.bdGateway === 'object' &&
      !Array.isArray(root.bdGateway)
      ? root.bdGateway as Record<string, unknown>
      : {};

    return {
      ...root,
      bdGateway: { ...existingBdGateway, ...bdGatewayPatch },
    };
  }

  async checkBdGatewayDepositTrxAsAdmin(
    depositId: string,
    smsTrxId: string,
    adminId: string,
  ) {
    const deposit = await this.findById(depositId);
    if (deposit.pspProvider !== BDGATEWAY_PROVIDER) {
      throw new BadRequestException('SMS TrxID verification is only available for BetPlatform BD gateway deposits');
    }
    if (deposit.status !== DepositStatus.PENDING_PAYMENT) {
      throw new BadRequestException('Only pending deposits can be checked');
    }

    const submittedSmsTrxId = smsTrxId.trim();
    if (!/^[A-Za-z0-9]{6,20}$/.test(submittedSmsTrxId)) {
      throw new BadRequestException('Enter a valid 6–20 character SMS TrxID');
    }

    const root = deposit.metadata && typeof deposit.metadata === 'object' && !Array.isArray(deposit.metadata)
      ? deposit.metadata as Record<string, unknown>
      : {};
    const bd = root.bdGateway && typeof root.bdGateway === 'object' && !Array.isArray(root.bdGateway)
      ? root.bdGateway as Record<string, unknown>
      : {};
    const customerTrxId = typeof bd.customerTrxId === 'string' ? bd.customerTrxId.trim() : '';

    if (!customerTrxId) {
      throw new BadRequestException('The customer has not submitted a TrxID for this deposit yet');
    }

    const matches = customerTrxId.toUpperCase() === submittedSmsTrxId.toUpperCase();
    const checkedAt = new Date().toISOString();
    const check = {
      customerTrxId,
      adminSmsTrxId: submittedSmsTrxId,
      matches,
      checkedAt,
      checkedBy: adminId,
    };
    const history = Array.isArray(bd.trxCheckHistory) ? bd.trxCheckHistory : [];
    await this.prisma.deposit.update({
      where: { id: depositId },
      data: {
        metadata: this.mergeBdGatewayMetadata(deposit.metadata, {
          adminSmsTrxId: submittedSmsTrxId,
          lastTrxCheck: check,
          trxCheckHistory: [...history, check].slice(-10),
        }) as any,
      },
    });

    return {
      depositId,
      matches,
      customerTrxId,
      adminSmsTrxId: submittedSmsTrxId,
      status: deposit.status,
      message: matches
        ? 'TrxID matched. Review the deposit and press Approve to credit the wallet.'
        : 'TrxID does not match. The deposit remains pending; correct the SMS TrxID and check again.',
    };
  }

  async approveBdGatewayDepositAsAdmin(depositId: string, adminId: string) {
    const deposit = await this.findById(depositId);
    if (deposit.pspProvider !== BDGATEWAY_PROVIDER) {
      throw new BadRequestException('Manual SMS approval is only available for BetPlatform BD gateway deposits');
    }
    if (deposit.status !== DepositStatus.PENDING_PAYMENT) {
      throw new BadRequestException('Only pending deposits can be approved');
    }

    const root = deposit.metadata && typeof deposit.metadata === 'object' && !Array.isArray(deposit.metadata)
      ? deposit.metadata as Record<string, unknown>
      : {};
    const bd = root.bdGateway && typeof root.bdGateway === 'object' && !Array.isArray(root.bdGateway)
      ? root.bdGateway as Record<string, unknown>
      : {};
    const customerTrxId = typeof bd.customerTrxId === 'string' ? bd.customerTrxId.trim() : '';
    const adminSmsTrxId = typeof bd.adminSmsTrxId === 'string' ? bd.adminSmsTrxId.trim() : '';
    const check = bd.lastTrxCheck && typeof bd.lastTrxCheck === 'object'
      ? bd.lastTrxCheck as Record<string, unknown>
      : null;

    if (
      !customerTrxId ||
      !adminSmsTrxId ||
      !check ||
      check.matches !== true ||
      check.customerTrxId !== customerTrxId ||
      check.adminSmsTrxId !== adminSmsTrxId ||
      customerTrxId.toUpperCase() !== adminSmsTrxId.toUpperCase()
    ) {
      throw new BadRequestException('Check the SMS TrxID and confirm an exact match before approving this deposit');
    }

    const pspReference = `${BDGATEWAY_PROVIDER}:${customerTrxId.toUpperCase()}`;
    const duplicate = await this.prisma.deposit.findUnique({ where: { pspReference } });
    if (duplicate && duplicate.id !== depositId) {
      throw new BadRequestException('This TrxID has already been used for another deposit');
    }

    await this.prisma.deposit.update({
      where: { id: depositId },
      data: {
        metadata: this.mergeBdGatewayMetadata(deposit.metadata, {
          approvedBy: adminId,
          approvedAt: new Date().toISOString(),
          approvedSmsTrxId: adminSmsTrxId,
        }) as any,
      },
    });

    await this.settle(
      pspReference,
      new Decimal(deposit.amount.toString()),
      'BDT',
      depositId,
      {
        settlementMode: 'ADMIN_SMS_TRX_MATCH',
        submittedTrxId: customerTrxId,
        adminSmsTrxId,
        checkedAt: check.checkedAt,
        checkedBy: check.checkedBy,
        approvedBy: adminId,
      },
    );

    return this.findById(depositId);
  }

  async rejectBdGatewayDepositAsAdmin(depositId: string, reason: string, adminId: string) {
    const deposit = await this.findById(depositId);
    if (deposit.pspProvider !== BDGATEWAY_PROVIDER) {
      throw new BadRequestException('Manual rejection is only available for BetPlatform BD gateway deposits');
    }
    if (deposit.status !== DepositStatus.PENDING_PAYMENT) {
      throw new BadRequestException('Only pending deposits can be rejected');
    }

    const cleanReason = reason.trim() || 'Rejected by administrator';
    await this.prisma.deposit.update({
      where: { id: depositId },
      data: {
        metadata: this.mergeBdGatewayMetadata(deposit.metadata, {
          rejectedBy: adminId,
          rejectedAt: new Date().toISOString(),
          rejectionReason: cleanReason,
        }) as any,
      },
    });
    await this.markFailed(depositId, cleanReason);
    return this.findById(depositId);
  }

  async getAdminDepositQueue(status?: DepositStatus, skip = 0, take = 50) {
    return this.prisma.deposit.findMany({
      where: status ? { status } : undefined,
      include: {
        user: { select: { id: true, email: true, username: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: Math.min(Math.max(take, 1), 100),
    });
  }

  async reconcileBdGatewayDepositAsAdmin(depositId: string) {
    const deposit = await this.findById(depositId);
    return this.reconcileBdGatewayDeposit(depositId, deposit.userId);
  }

  /** Re-check one deposit against the gateway — for late or lost webhooks. */
  async reconcileBdGatewayDeposit(
    depositId: string,
    userId: string,
  ): Promise<{ depositId: string; status: string; gatewayStatus: string }> {
    const deposit = await this.findById(depositId);
    if (deposit.userId !== userId) {
      throw new NotFoundException(`Deposit ${depositId} not found`);
    }

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
    if (deposit.pspSessionId !== order.reference) {
      this.logger.error(`BD gateway order reference mismatch for deposit ${deposit.id}`);
      return;
    }
    if (
      (order.currency ?? '').toUpperCase() !== 'BDT' ||
      !new Decimal(order.amountBdt).equals(new Decimal(deposit.amount.toString()))
    ) {
      this.logger.error(`BD gateway amount/currency mismatch for deposit ${deposit.id}; refusing settlement`);
      await this.markFailed(deposit.id, 'Gateway amount or currency did not match the original deposit request');
      return;
    }

    // The external gateway's status is recorded for the admin, but it never
    // credits a BetPlatform wallet. Final approval must happen in this site's
    // Payments panel after the admin compares the customer's TrxID with the
    // TrxID in the receiving mobile-banking SMS.
    const existingRoot = deposit.metadata && typeof deposit.metadata === 'object' && !Array.isArray(deposit.metadata)
      ? deposit.metadata as Record<string, unknown>
      : {};
    const existingBd = existingRoot.bdGateway && typeof existingRoot.bdGateway === 'object' && !Array.isArray(existingRoot.bdGateway)
      ? existingRoot.bdGateway as Record<string, unknown>
      : {};
    const previouslySubmittedTrxId = typeof existingBd.customerTrxId === 'string'
      ? existingBd.customerTrxId
      : order.submittedTrxId ?? null;

    await this.prisma.deposit.update({
      where: { id: deposit.id },
      data: {
        metadata: this.mergeBdGatewayMetadata(deposit.metadata, {
          customerTrxId: previouslySubmittedTrxId,
          gatewayReportedStatus: order.status,
          gatewaySubmittedTrxId: order.submittedTrxId ?? null,
          gatewayCheckedAt: new Date().toISOString(),
          gatewayCustomerMsisdn: order.customerMsisdn ?? null,
          gatewayReceivingNumber: order.receivingNumber,
        }) as any,
      },
    });

    this.logger.log(
      `Gateway order ${order.reference} reported ${order.status}; awaiting admin SMS TrxID verification for deposit ${deposit.id}`,
    );
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
    const deposits = await this.prisma.deposit.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
    // The gateway order reference is a backend-only identifier. Customers
    // need the public payment instructions, not the merchant-side reference.
    return deposits.map(({ pspSessionId: _gatewayOrderReference, ...deposit }) => deposit);
  }

  // ─── Private: event routing ─────────────────────────────────────────────────

  private async handleSuccess(data: Record<string, unknown>): Promise<void> {
    const pspReference = (data['pspReference'] ?? data['id'] ?? data['payment_intent']) as string | undefined;
    const rawAmount = data['amount'] ?? data['amount_received'];
    const currency = ((data['currency'] as string | undefined) ?? 'BDT').toUpperCase();

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
