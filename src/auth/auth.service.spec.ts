import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { hash } from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;

  const prisma = {
    user: {
      create: jest.fn(),
      findUnique: jest.fn(),
    },
  };
  const jwt = { signAsync: jest.fn() };
  const config = { get: jest.fn().mockReturnValue(3600) };

  beforeEach(async () => {
    jest.clearAllMocks();
    jwt.signAsync.mockResolvedValue('signed.jwt.token');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwt },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  it('registers a user with a password hash and issues a JWT', async () => {
    prisma.user.create.mockResolvedValue({
      id: 'a931797d-e347-41c8-a75d-e9504894395b',
      email: 'engineer@example.com',
    });

    const result = await service.register(
      'engineer@example.com',
      'StrongPassword123!',
    );

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: {
        email: 'engineer@example.com',
        passwordHash: expect.any(String),
      },
      select: { id: true, email: true },
    });
    expect(jwt.signAsync).toHaveBeenCalledWith(
      {
        sub: 'a931797d-e347-41c8-a75d-e9504894395b',
        email: 'engineer@example.com',
      },
      { expiresIn: 3600 },
    );
    expect(result.accessToken).toBe('signed.jwt.token');
  });

  it('rejects a duplicate registration email', async () => {
    prisma.user.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint', {
        code: 'P2002',
        clientVersion: '6.19.3',
      }),
    );

    await expect(
      service.register('engineer@example.com', 'StrongPassword123!'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects invalid login credentials', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'a931797d-e347-41c8-a75d-e9504894395b',
      email: 'engineer@example.com',
      passwordHash: await hash('DifferentPassword123!', 4),
    });

    await expect(
      service.login('engineer@example.com', 'StrongPassword123!'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
