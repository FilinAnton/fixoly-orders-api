import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Order, OrderStatus, WindowType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from './orders.service';

describe('OrdersService', () => {
  let service: OrdersService;

  const order: Order = {
    id: '93b1d465-7ed7-4fd0-b734-e092c7f2c67e',
    clientName: 'Jane Smith',
    address: '42 King Street, Toronto, ON',
    windowType: WindowType.tilt_turn,
    width: 120,
    height: 140,
    status: OrderStatus.new,
    createdAt: new Date('2026-09-18T10:00:00.000Z'),
    updatedAt: new Date('2026-09-18T10:00:00.000Z'),
  };

  const prisma = {
    order: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [OrdersService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(OrdersService);
  });

  it('creates a validated order with the default database status', async () => {
    prisma.order.create.mockResolvedValue(order);

    const result = await service.create({
      clientName: order.clientName,
      address: order.address,
      windowType: order.windowType,
      width: order.width,
      height: order.height,
    });

    expect(result).toEqual(order);
    expect(prisma.order.create).toHaveBeenCalledWith({
      data: {
        clientName: order.clientName,
        address: order.address,
        windowType: order.windowType,
        width: order.width,
        height: order.height,
      },
    });
  });

  it('returns filtered, paginated orders with metadata', async () => {
    prisma.order.findMany.mockResolvedValue([order]);
    prisma.order.count.mockResolvedValue(1);
    prisma.$transaction.mockResolvedValue([[order], 1]);

    const result = await service.findAll({
      status: OrderStatus.new,
      page: 2,
      limit: 10,
    });

    expect(prisma.order.findMany).toHaveBeenCalledWith({
      where: { status: OrderStatus.new },
      skip: 10,
      take: 10,
      orderBy: { createdAt: 'desc' },
    });
    expect(result.meta).toEqual({
      page: 2,
      limit: 10,
      total: 1,
      totalPages: 1,
    });
  });

  it('updates an existing order status', async () => {
    const updated = { ...order, status: OrderStatus.in_progress };
    prisma.order.findUnique.mockResolvedValue(order);
    prisma.order.update.mockResolvedValue(updated);

    const result = await service.updateStatus(order.id, {
      status: OrderStatus.in_progress,
    });

    expect(result.status).toBe(OrderStatus.in_progress);
    expect(prisma.order.update).toHaveBeenCalledWith({
      where: { id: order.id },
      data: { status: OrderStatus.in_progress },
    });
  });

  it('returns 404 semantics when an order does not exist', async () => {
    prisma.order.findUnique.mockResolvedValue(null);

    await expect(service.findOne(order.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
