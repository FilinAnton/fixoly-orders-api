import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, Payment, PaymentStatus } from '@prisma/client';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';

export interface PaymentIntentResult {
  paymentId: string;
  orderId: string;
  stripePaymentIntentId: string;
  status: PaymentStatus;
  amount: number;
  applicationFeeAmount: number;
  contractorAmount: number;
  currency: string;
  clientSecret: string | null;
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
  ) {}

  async createIntent(
    dto: CreatePaymentIntentDto,
    requestedIdempotencyKey?: string,
  ): Promise<PaymentIntentResult> {
    const idempotencyKey = this.normalizeIdempotencyKey(
      requestedIdempotencyKey ?? `order-payment:${dto.orderId}`,
    );

    const existing = await this.prisma.payment.findUnique({
      where: { orderId: dto.orderId },
    });
    if (existing) {
      if (
        existing.contractorId !== dto.contractorId ||
        existing.amount !== dto.amount ||
        existing.currency !== dto.currency
      ) {
        throw new ConflictException(
          'The order already has a payment with different parameters',
        );
      }
      const intent = await this.stripe.client.paymentIntents.retrieve(
        existing.stripePaymentIntentId,
      );
      return this.toIntentResult(existing, intent.client_secret);
    }

    const reusedKey = await this.prisma.payment.findUnique({
      where: { idempotencyKey },
    });
    if (reusedKey) {
      throw new ConflictException(
        'The Idempotency-Key already belongs to another payment',
      );
    }

    const [order, contractor] = await Promise.all([
      this.prisma.order.findUnique({ where: { id: dto.orderId } }),
      this.prisma.contractor.findUnique({
        where: { id: dto.contractorId },
      }),
    ]);

    if (!order) {
      throw new NotFoundException(`Order ${dto.orderId} was not found`);
    }
    if (!contractor) {
      throw new NotFoundException(
        `Contractor ${dto.contractorId} was not found`,
      );
    }
    if (
      !contractor.detailsSubmitted ||
      !contractor.chargesEnabled ||
      !contractor.payoutsEnabled
    ) {
      throw new ConflictException(
        'Contractor must complete Stripe onboarding before receiving payments',
      );
    }

    const applicationFeeAmount = Math.round(dto.amount * 0.05);
    const intent = await this.stripe.client.paymentIntents.create(
      {
        amount: dto.amount,
        currency: dto.currency,
        capture_method: 'manual',
        payment_method_types: ['card'],
        application_fee_amount: applicationFeeAmount,
        transfer_data: { destination: contractor.stripeAccountId },
        metadata: {
          orderId: order.id,
          contractorId: contractor.id,
          paymentFlow: 'destination_charge_manual_capture',
        },
      },
      { idempotencyKey },
    );
    if (intent.metadata.orderId !== order.id) {
      throw new ConflictException(
        'The Idempotency-Key was previously used for another order',
      );
    }

    const payment = await this.prisma.payment.create({
      data: {
        orderId: order.id,
        contractorId: contractor.id,
        stripePaymentIntentId: intent.id,
        idempotencyKey,
        amount: dto.amount,
        applicationFeeAmount,
        currency: dto.currency,
        status: this.mapIntentStatus(intent.status),
      },
    });

    return this.toIntentResult(payment, intent.client_secret);
  }

  async completeOrder(orderId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { orderId },
      include: { order: true },
    });

    if (!payment) {
      throw new NotFoundException(`Payment for order ${orderId} was not found`);
    }

    if (
      payment.status === PaymentStatus.succeeded &&
      payment.order.status === OrderStatus.completed
    ) {
      return this.captureResult(payment, 'already_captured');
    }
    if (payment.status === PaymentStatus.disputed) {
      throw new ConflictException('Disputed payments cannot be captured');
    }

    const currentIntent = await this.stripe.client.paymentIntents.retrieve(
      payment.stripePaymentIntentId,
    );

    let capturedIntent: Stripe.PaymentIntent;
    if (currentIntent.status === 'requires_capture') {
      capturedIntent = await this.stripe.client.paymentIntents.capture(
        currentIntent.id,
        {},
        { idempotencyKey: `capture:${payment.id}` },
      );
    } else if (currentIntent.status === 'succeeded') {
      capturedIntent = currentIntent;
    } else {
      throw new ConflictException(
        `PaymentIntent cannot be captured from status ${currentIntent.status}`,
      );
    }

    const stripeChargeId = this.getChargeId(capturedIntent.latest_charge);
    const now = new Date();
    const [updatedPayment] = await this.prisma.$transaction([
      this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: this.mapIntentStatus(capturedIntent.status),
          stripeChargeId,
          capturedAt: now,
        },
      }),
      this.prisma.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.completed },
      }),
    ]);

    return this.captureResult(updatedPayment, 'captured');
  }

  async cancel(paymentId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });
    if (!payment) {
      throw new NotFoundException(`Payment ${paymentId} was not found`);
    }

    if (payment.status === PaymentStatus.canceled) {
      return { paymentId, status: PaymentStatus.canceled };
    }
    if (payment.status === PaymentStatus.succeeded) {
      throw new ConflictException('Captured payments cannot be canceled');
    }

    const canceled = await this.stripe.client.paymentIntents.cancel(
      payment.stripePaymentIntentId,
      {},
      { idempotencyKey: `cancel:${payment.id}` },
    );
    const updated = await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: this.mapIntentStatus(canceled.status),
        canceledAt: new Date(),
      },
    });

    return { paymentId: updated.id, status: updated.status };
  }

  private normalizeIdempotencyKey(value: string): string {
    const key = value.trim();
    if (key.length < 8 || key.length > 255) {
      throw new BadRequestException(
        'Idempotency-Key must contain between 8 and 255 characters',
      );
    }
    return key;
  }

  private mapIntentStatus(status: Stripe.PaymentIntent.Status): PaymentStatus {
    const mapping: Record<Stripe.PaymentIntent.Status, PaymentStatus> = {
      canceled: PaymentStatus.canceled,
      processing: PaymentStatus.processing,
      requires_action: PaymentStatus.requires_action,
      requires_capture: PaymentStatus.requires_capture,
      requires_confirmation: PaymentStatus.pending,
      requires_payment_method: PaymentStatus.pending,
      succeeded: PaymentStatus.succeeded,
    };
    return mapping[status];
  }

  private getChargeId(
    latestCharge: string | Stripe.Charge | null,
  ): string | null {
    if (!latestCharge) return null;
    return typeof latestCharge === 'string' ? latestCharge : latestCharge.id;
  }

  private toIntentResult(
    payment: Payment,
    clientSecret: string | null,
  ): PaymentIntentResult {
    return {
      paymentId: payment.id,
      orderId: payment.orderId,
      stripePaymentIntentId: payment.stripePaymentIntentId,
      status: payment.status,
      amount: payment.amount,
      applicationFeeAmount: payment.applicationFeeAmount,
      contractorAmount: payment.amount - payment.applicationFeeAmount,
      currency: payment.currency,
      clientSecret,
    };
  }

  private captureResult(
    payment: Payment,
    outcome: 'captured' | 'already_captured',
  ) {
    return {
      orderId: payment.orderId,
      paymentId: payment.id,
      stripePaymentIntentId: payment.stripePaymentIntentId,
      status: payment.status,
      outcome,
      amount: payment.amount,
      applicationFeeAmount: payment.applicationFeeAmount,
      contractorAmount: payment.amount - payment.applicationFeeAmount,
      currency: payment.currency,
    };
  }
}
