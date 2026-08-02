import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface AdminUserFindAllParams {
  search?: string;
  isActive?: boolean;
  skip?: number;
  take?: number;
}

@Injectable()
export class AdminUsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(params: AdminUserFindAllParams = {}) {
    const { search, isActive, skip = 0, take = 25 } = params;
    return this.prisma.user.findMany({
      where: {
        ...(isActive !== undefined ? { isActive } : {}),
        ...(search
          ? {
              OR: [
                { email: { contains: search, mode: 'insensitive' } },
                { username: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        isActive: true,
        kycVerified: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
  }
}
