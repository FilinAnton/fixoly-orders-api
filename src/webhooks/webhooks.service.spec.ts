import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { PaymentStatus, Prisma, WebhookProcessingStatus } from '@prisma/client';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { WebhooksService } from './webhooks.service';

describe('WebhooksService', () => {
  let service: WebhooksService;

  const event = {
    id: 'evt_test_123',
    type: 'payment_intent.amount_capturable_updated',
    data: {
      object: {
        id: 'pi_test_123',
        object: 'payment_intent',
        latest_charge: null,
        metadata: {
          paymentFlow: 'destination_charge_manual_capture',
        },
      },
    },
  } as unknown as Stripe.Event;

  const prisma = {
    webhookEvent: {
      create: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    payment: { updateMany: jest.fn() },
    contractor: { updateMany: jest.fn() },
  };

  const stripe = {
    client: {
      webhooks: { constructEvent: jest.fn() },
    },
  };

  const config = {
    getOrThrow: jest.fn().mockReturnValue('whsec_test_123'),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhooksService,
        { provide: PrismaService, useValue: prisma },
        { provide: StripeService, useValue: stripe },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    service = module.get(WebhooksService);
  });

  it('verifies and records an authorization event exactly once', async () => {
    stripe.client.webhooks.constructEvent.mockReturnValue(event);
    prisma.webhookEvent.create.mockResolvedValue({ id: 'local-event-id' });
    prisma.payment.updateMany.mockResolvedValue({ count: 1 });
    prisma.webhookEvent.update.mockResolvedValue({});

    const result = await service.processStripeEvent(
      Buffer.from('{}'),
      'valid-signature',
    );

    expect(stripe.client.webhooks.constructEvent).toHaveBeenCalledWith(
      Buffer.from('{}'),
      'valid-signature',
      'whsec_test_123',
    );
    expect(prisma.payment.updateMany).toHaveBeenCalledWith({
      where: { stripePaymentIntentId: 'pi_test_123' },
      data: {
        status: PaymentStatus.requires_capture,
        authorizedAt: expect.any(Date),
      },
    });
    expect(result).toEqual({
      received: true,
      duplicate: false,
      eventId: event.id,
    });
  });

  it('acknowledges a previously processed duplicate without applying it', async () => {
    stripe.client.webhooks.constructEvent.mockReturnValue(event);
    prisma.webhookEvent.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint', {
        code: 'P2002',
        clientVersion: '6.19.3',
      }),
    );
    prisma.webhookEvent.findUniqueOrThrow.mockResolvedValue({
      status: WebhookProcessingStatus.processed,
    });

    const result = await service.processStripeEvent(
      Buffer.from('{}'),
      'valid-signature',
    );

    expect(result.duplicate).toBe(true);
    expect(prisma.payment.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a webhook with an invalid signature before touching storage', async () => {
    stripe.client.webhooks.constructEvent.mockImplementation(() => {
      throw new Error('No signatures found');
    });

    await expect(
      service.processStripeEvent(Buffer.from('{}'), 'invalid-signature'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.webhookEvent.create).not.toHaveBeenCalled();
  });
});
