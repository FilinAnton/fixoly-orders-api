import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  OrderStatus,
  Payment,
  PaymentStatus,
  WindowType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { PaymentsService } from './payments.service';

describe('PaymentsService', () => {
  let service: PaymentsService;

  const orderId = '93b1d465-7ed7-4fd0-b734-e092c7f2c67e';
  const contractorId = 'f91f5ea2-9481-4ea7-952f-dc5f6792766e';
  const paymentId = '2625b724-9c52-45b7-a064-6fd160f32de6';
  const now = new Date('2026-09-20T10:00:00.000Z');

  const payment: Payment = {
    id: paymentId,
    orderId,
    contractorId,
    stripePaymentIntentId: 'pi_test_123',
    stripeChargeId: null,
    idempotencyKey: `order-payment:${orderId}`,
    amount: 25_000,
    applicationFeeAmount: 1_250,
    currency: 'cad',
    status: PaymentStatus.requires_capture,
    authorizedAt: now,
    capturedAt: null,
    canceledAt: null,
    disputeId: null,
    createdAt: now,
    updatedAt: now,
  };

  const prisma = {
    order: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    contractor: { findUnique: jest.fn() },
    payment: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const stripe = {
    client: {
      paymentIntents: {
        create: jest.fn(),
        retrieve: jest.fn(),
        capture: jest.fn(),
        cancel: jest.fn(),
      },
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StripeService, useValue: stripe },
      ],
    }).compile();

    service = module.get(PaymentsService);
  });

  it('creates a manual-capture destination charge with a five-percent fee', async () => {
    prisma.payment.findUnique.mockResolvedValue(null);
    prisma.order.findUnique.mockResolvedValue({ id: orderId });
    prisma.contractor.findUnique.mockResolvedValue({
      id: contractorId,
      stripeAccountId: 'acct_test_123',
      detailsSubmitted: true,
      chargesEnabled: true,
      payoutsEnabled: true,
    });
    stripe.client.paymentIntents.create.mockResolvedValue({
      id: 'pi_test_123',
      status: 'requires_payment_method',
      client_secret: 'pi_test_123_secret',
      metadata: { orderId },
    });
    prisma.payment.create.mockResolvedValue({
      ...payment,
      status: PaymentStatus.pending,
      authorizedAt: null,
    });

    const result = await service.createIntent({
      orderId,
      contractorId,
      amount: 25_000,
      currency: 'cad',
    });

    expect(stripe.client.paymentIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 25_000,
        currency: 'cad',
        capture_method: 'manual',
        application_fee_amount: 1_250,
        transfer_data: { destination: 'acct_test_123' },
      }),
      { idempotencyKey: `order-payment:${orderId}` },
    );
    expect(result.contractorAmount).toBe(23_750);
  });

  it('captures an authorized payment and completes its order atomically', async () => {
    prisma.payment.findUnique.mockResolvedValue({
      ...payment,
      order: {
        id: orderId,
        clientName: 'Jane Smith',
        address: '42 King Street',
        windowType: WindowType.tilt_turn,
        width: 120,
        height: 140,
        status: OrderStatus.in_progress,
        createdAt: now,
        updatedAt: now,
      },
    });
    stripe.client.paymentIntents.retrieve.mockResolvedValue({
      id: 'pi_test_123',
      status: 'requires_capture',
    });
    stripe.client.paymentIntents.capture.mockResolvedValue({
      id: 'pi_test_123',
      status: 'succeeded',
      latest_charge: 'ch_test_123',
    });
    prisma.payment.update.mockReturnValue('payment-update');
    prisma.order.update.mockReturnValue('order-update');
    prisma.$transaction.mockResolvedValue([
      {
        ...payment,
        status: PaymentStatus.succeeded,
        stripeChargeId: 'ch_test_123',
        capturedAt: now,
      },
      { id: orderId, status: OrderStatus.completed },
    ]);

    const result = await service.completeOrder(orderId);

    expect(stripe.client.paymentIntents.capture).toHaveBeenCalledWith(
      'pi_test_123',
      {},
      { idempotencyKey: `capture:${paymentId}` },
    );
    expect(prisma.$transaction).toHaveBeenCalledWith([
      'payment-update',
      'order-update',
    ]);
    expect(result).toEqual(
      expect.objectContaining({
        status: PaymentStatus.succeeded,
        outcome: 'captured',
      }),
    );
  });

  it('refuses to capture a PaymentIntent before card authorization', async () => {
    prisma.payment.findUnique.mockResolvedValue({
      ...payment,
      status: PaymentStatus.pending,
      order: { status: OrderStatus.in_progress },
    });
    stripe.client.paymentIntents.retrieve.mockResolvedValue({
      id: 'pi_test_123',
      status: 'requires_payment_method',
    });

    await expect(service.completeOrder(orderId)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(stripe.client.paymentIntents.capture).not.toHaveBeenCalled();
  });
});
