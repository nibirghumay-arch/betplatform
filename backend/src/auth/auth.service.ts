import { Injectable, ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { Prisma, WalletType } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto, LoginDto } from './dto/auth.dto';

const BCRYPT_ROUNDS = 12;

const USER_SELECT = {
  id: true,
  email: true,
  username: true,
  role: true,
  isActive: true,
  kycVerified: true,
  emailVerifiedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export interface UserProfile {
  id: string;
  email: string;
  username: string;
  role: string;
  isActive: boolean;
  kycVerified: boolean;
  emailVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();
    const username = dto.username.trim().toLowerCase();

    const existingByEmail = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: {
        id: true,
        email: true,
        username: true,
        passwordHash: true,
        isActive: true,
        emailVerifiedAt: true,
      },
    });

    if (existingByEmail) {
      const sameUsername = existingByEmail.username.toLowerCase() === username;

      // If an earlier attempt created the user but failed before returning a
      // successful response, let the same customer safely resume registration
      // using the exact same email, username, and password.
      if (sameUsername && await bcrypt.compare(dto.password, existingByEmail.passwordHash)) {
        if (!existingByEmail.isActive) {
          throw new ConflictException('This account is disabled. Please contact site support.');
        }
        return this.prisma.$transaction(async (tx) => {
          const user = await tx.user.update({
            where: { id: existingByEmail.id },
            data: { emailVerifiedAt: existingByEmail.emailVerifiedAt ?? new Date() },
            select: USER_SELECT,
          });
          const wallet = await tx.wallet.findUnique({ where: { userId: user.id }, select: { id: true } });
          if (!wallet) {
            await tx.wallet.create({
              data: { userId: user.id, walletType: WalletType.USER, currency: 'USD' },
              select: { id: true },
            });
          }
          return this.issueTokenPair(user, tx);
        });
      }

      throw new ConflictException('This email is already registered. Sign in or use another email.');
    }

    const existingByUsername = await this.prisma.user.findFirst({
      where: { username: { equals: username, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existingByUsername) {
      throw new ConflictException('This username is already taken. Please choose another username.');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    try {
      // Keep account, wallet and session creation atomic. A failed wallet/session
      // creation must not leave a partial account that blocks a retry.
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email,
            username,
            passwordHash,
            emailVerifiedAt: new Date(),
            isActive: true,
          },
          select: USER_SELECT,
        });

        await tx.wallet.create({
          data: { userId: user.id, walletType: WalletType.USER, currency: 'USD' },
          select: { id: true },
        });

        return this.issueTokenPair(user, tx);
      });
    } catch (error) {
      // Handle the race where two requests register the same email/username
      // between the friendly pre-check and the database's unique constraint.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const duplicateEmail = await this.prisma.user.findFirst({
          where: { email: { equals: email, mode: 'insensitive' } },
          select: { id: true },
        });
        if (duplicateEmail) {
          throw new ConflictException('This email is already registered. Sign in or use another email.');
        }
        throw new ConflictException('This username is already taken. Please choose another username.');
      }
      throw error;
    }
  }

  async login(dto: LoginDto) {
    const suppliedEmail = dto.email.trim();
    const normalizedEmail = suppliedEmail.toLowerCase();

    // Read every case-insensitive match instead of only the first one. Older
    // releases stored the email exactly as it was typed, while newer releases
    // normalize it to lowercase. PostgreSQL's unique index is case-sensitive,
    // so older data can contain the same address with different casing.
    const candidates = await this.prisma.user.findMany({
      where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
      select: { ...USER_SELECT, passwordHash: true },
      orderBy: { createdAt: 'desc' },
    });

    // Match the password against each legacy candidate. This prevents a
    // different-case duplicate from being selected before the actual account.
    const matchingUsers: typeof candidates = [];
    for (const candidate of candidates) {
      if (await bcrypt.compare(dto.password, candidate.passwordHash)) {
        matchingUsers.push(candidate);
      }
    }

    if (matchingUsers.length === 0) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // Prefer the exact casing the customer entered when duplicate legacy
    // records exist; otherwise use the newest password-matching record.
    const user = matchingUsers.find((candidate) => candidate.email === suppliedEmail)
      ?? matchingUsers[0];

    if (!user.isActive) throw new UnauthorizedException('Account is disabled');

    const { passwordHash: _pw, ...safeUser } = user;
    return this.issueTokenPair(safeUser);
  }

  async refresh(refreshToken: string) {
    let payload: { sub: string };
    try {
      payload = this.jwt.verify<{ sub: string }>(refreshToken);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokenHash = this.hashToken(refreshToken);
    const session = await this.prisma.session.findUnique({ where: { tokenHash } });
    if (!session || session.expiresAt < new Date()) {
      if (session) await this.prisma.session.delete({ where: { tokenHash } });
      throw new UnauthorizedException('Refresh token expired or revoked');
    }

    // Rotate: delete current session before issuing new pair
    await this.prisma.session.delete({ where: { tokenHash } });

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: payload.sub },
      select: USER_SELECT,
    });
    if (!user.isActive) throw new UnauthorizedException('Account is disabled');

    return this.issueTokenPair(user);
  }

  async logout(refreshToken: string) {
    const tokenHash = this.hashToken(refreshToken);
    await this.prisma.session.deleteMany({ where: { tokenHash } });
    return { message: 'Logged out' };
  }

  async me(userId: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: USER_SELECT,
    });
  }

  async devVerify(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new UnauthorizedException('User not found');
    await this.prisma.user.update({
      where: { email },
      data: { emailVerifiedAt: new Date(), isActive: true },
    });
    return { message: 'verified' };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async issueTokenPair(
    user: UserProfile,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const accessToken = this.jwt.sign({ sub: user.id, email: user.email, role: user.role });

    // Refresh token uses the same secret but longer expiry; type claim prevents
    // it being accepted by the JWT strategy as an access token.
    const refreshExpiry = process.env.JWT_REFRESH_EXPIRES_IN ?? '7d';
    const refreshToken = this.jwt.sign(
      { sub: user.id, type: 'refresh' },
      { expiresIn: refreshExpiry },
    );

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    await db.session.create({
      data: { userId: user.id, tokenHash: this.hashToken(refreshToken), expiresAt },
    });

    return { user, accessToken, refreshToken };
  }
}
