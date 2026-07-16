import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Argon2Service } from '../common/security/argon2.service';
import { User } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly argon2: Argon2Service,
  ) {}

  async createLocal(params: {
    email: string;
    password: string;
    displayName: string;
  }): Promise<User> {
    const passwordHash = await this.argon2.hash(params.password);
    return this.prisma.forSystem().user.create({
      data: {
        email: params.email,
        displayName: params.displayName,
        passwordHash,
      },
    });
  }

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.forSystem().user.findUnique({ where: { email } });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.forSystem().user.findUnique({ where: { id } });
  }

  findWorkspaces(userId: string) {
    // Cross-workspace query — lists all memberships for a user regardless of context
    return this.prisma.forSystem().workspaceMember.findMany({
      where: { userId },
      include: { workspace: true },
      orderBy: { joinedAt: 'asc' },
    });
  }
}
