import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PaymentMethod, PaymentMethodType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreatePaymentMethodDto,
  UpdatePaymentMethodDto,
  isValidMobileAccountNumber,
  MOBILE_WALLET_TYPES,
} from './dto/payment-method.dto';

/**
 * A user may save several mobile wallet / bank / card payment methods
 * (bKash, Nagad, Rocket, Upay, mCash, Tap, bank, card). Exactly one of them
 * is the "default" — the one deposits/withdrawals use unless the user
 * explicitly picks a different saved one for that transaction. The user can
 * switch which one is default at any time; switching never deletes the
 * others.
 *
 * Enforcement of "exactly one default" is done here transactionally rather
 * than with a DB partial-unique-index, since that isn't portable through
 * Prisma's schema DSL — every mutation that sets isDefault=true first clears
 * isDefault on all of the user's other methods in the same transaction.
 */
@Injectable()
export class PaymentMethodService {
  private readonly logger = new Logger(PaymentMethodService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreatePaymentMethodDto): Promise<PaymentMethod> {
    if (MOBILE_WALLET_TYPES.includes(dto.type) && !isValidMobileAccountNumber(dto.accountNumber)) {
      throw new BadRequestException(
        `${dto.type} account number must be an 11-digit Bangladeshi mobile number (e.g. 01712345678)`,
      );
    }

    const existingCount = await this.prisma.paymentMethod.count({ where: { userId } });

    // Prevent saving the exact same account+type twice.
    const duplicate = await this.prisma.paymentMethod.findFirst({
      where: { userId, type: dto.type, accountNumber: dto.accountNumber },
    });
    if (duplicate) {
      throw new BadRequestException(
        `A ${dto.type} payment method with this account number is already saved`,
      );
    }

    // First-ever method is always the default, regardless of what was asked.
    const shouldBeDefault = existingCount === 0 || dto.makeDefault === true;

    return this.prisma.$transaction(async (tx) => {
      if (shouldBeDefault) {
        await tx.paymentMethod.updateMany({
          where: { userId, isDefault: true },
          data: { isDefault: false },
        });
      }

      const created = await tx.paymentMethod.create({
        data: {
          userId,
          type: dto.type,
          accountNumber: dto.accountNumber,
          accountHolder: dto.accountHolder,
          bankName: dto.bankName,
          branchName: dto.branchName,
          routingNumber: dto.routingNumber,
          label: dto.label,
          isDefault: shouldBeDefault,
        },
      });

      this.logger.log(
        `Payment method created: id=${created.id} userId=${userId} type=${dto.type} default=${shouldBeDefault}`,
      );
      return created;
    });
  }

  async listByUser(userId: string): Promise<PaymentMethod[]> {
    return this.prisma.paymentMethod.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async findOwned(id: string, userId: string): Promise<PaymentMethod> {
    const method = await this.prisma.paymentMethod.findUnique({ where: { id } });
    if (!method) throw new NotFoundException(`Payment method ${id} not found`);
    if (method.userId !== userId) {
      throw new ForbiddenException(`Payment method ${id} does not belong to this user`);
    }
    return method;
  }

  async update(id: string, userId: string, dto: UpdatePaymentMethodDto): Promise<PaymentMethod> {
    await this.findOwned(id, userId);
    return this.prisma.paymentMethod.update({
      where: { id },
      data: {
        accountHolder: dto.accountHolder,
        bankName: dto.bankName,
        branchName: dto.branchName,
        routingNumber: dto.routingNumber,
        label: dto.label,
      },
    });
  }

  /**
   * Switch the active/default method. The previous default is simply
   * demoted — nothing is deleted, so the user can switch back later.
   */
  async setDefault(id: string, userId: string): Promise<PaymentMethod> {
    const method = await this.findOwned(id, userId);
    if (method.isDefault) return method;

    return this.prisma.$transaction(async (tx) => {
      await tx.paymentMethod.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      });
      const updated = await tx.paymentMethod.update({
        where: { id },
        data: { isDefault: true },
      });
      this.logger.log(`Default payment method switched: userId=${userId} newDefault=${id}`);
      return updated;
    });
  }

  async remove(id: string, userId: string): Promise<void> {
    const method = await this.findOwned(id, userId);

    await this.prisma.$transaction(async (tx) => {
      await tx.paymentMethod.delete({ where: { id } });

      // If we just removed the default, promote the most recently added
      // remaining method so the user always has an active method if any exist.
      if (method.isDefault) {
        const next = await tx.paymentMethod.findFirst({
          where: { userId },
          orderBy: { createdAt: 'desc' },
        });
        if (next) {
          await tx.paymentMethod.update({ where: { id: next.id }, data: { isDefault: true } });
        }
      }
    });

    this.logger.log(`Payment method removed: id=${id} userId=${userId}`);
  }

  async getDefault(userId: string): Promise<PaymentMethod | null> {
    return this.prisma.paymentMethod.findFirst({ where: { userId, isDefault: true } });
  }

  /** Used by WithdrawalService to resolve which saved method a payout should
   * go to: an explicitly requested one, else the user's current default. */
  async resolveForWithdrawal(userId: string, paymentMethodId?: string): Promise<PaymentMethod> {
    if (paymentMethodId) {
      return this.findOwned(paymentMethodId, userId);
    }
    const def = await this.getDefault(userId);
    if (!def) {
      throw new BadRequestException(
        'No payment method on file. Add a bKash, Nagad, Rocket, Upay, or bank account first.',
      );
    }
    return def;
  }

  /** Snapshot of a payment method safe to embed into payoutDetails/metadata
   * JSON — mobile numbers are partially masked for anything logged or shown
   * outside the owner's own account view. */
  toPayoutSnapshot(method: PaymentMethod): Record<string, unknown> {
    return {
      paymentMethodId: method.id,
      type: method.type,
      accountNumber: method.accountNumber,
      accountHolder: method.accountHolder ?? undefined,
      bankName: method.bankName ?? undefined,
      branchName: method.branchName ?? undefined,
      routingNumber: method.routingNumber ?? undefined,
    };
  }

  static maskAccountNumber(accountNumber: string): string {
    if (accountNumber.length <= 4) return accountNumber;
    return `${'*'.repeat(accountNumber.length - 4)}${accountNumber.slice(-4)}`;
  }
}
