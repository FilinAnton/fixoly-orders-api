import { BadRequestException, Injectable } from '@nestjs/common';
import { PaymentStatus, Prisma, WebhookProcessingStatus } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';

@Injectable()
export class WebhooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    private readonly config: ConfigService,
  ) {}

  async processStripeEvent(rawBody: Buffer, signature: string) {
    let event: Stripe.Event;
    try {
      event = this.stripe.client.webhooks.constructEvent(
        rawBody,
        signature,
        this.config.getOrThrow<string>('STRIPE_WEBHOOK_SECRET'),
      );
    } catch {
      throw new BadRequestException('Invalid Stripe webhook signature');
    }

    const claimed = await this.claim(event);
    if (!claimed) {
      return { received: true, duplicate: true, eventId: event.id };
    }

    try {
      await this.handle(event);
      await this.prisma.webhookEvent.update({
        where: { stripeEventId: event.id },
        data: {
          status: WebhookProcessingStatus.processed,
          processedAt: new Date(),
          lastError: null,
        },
      });
    } catch (error) {
      await this.prisma.webhookEvent.update({
        where: { stripeEventId: event.id },
        data: {
          status: WebhookProcessingStatus.failed,
          lastError: this.errorMessage(error),
        },
      });
      throw error;
    }

    return { received: true, duplicate: false, eventId: event.id };
  }

  private async claim(event: Stripe.Event): Promise<boolean> {
    try {
      await this.prisma.webhookEvent.create({
        data: {
          stripeEventId: event.id,
          type: event.type,
        },
      });
      return true;
    } catch (error) {
      if (!this.isUniqueViolation(error)) throw error;
    }

    const existing = await this.prisma.webhookEvent.findUniqueOrThrow({
      where: { stripeEventId: event.id },
    });
    if (existing.status !== WebhookProcessingStatus.failed) return false;

    const retry = await this.prisma.webhookEvent.updateMany({
      where: {
        stripeEventId: event.id,
        status: WebhookProcessingStatus.failed,
      },
      data: {
        status: WebhookProcessingStatus.processing,
        attempts: { increment: 1 },
        lastError: null,
      },
    });
    return retry.count === 1;
  }

  private async handle(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'payment_intent.amount_capturable_updated':
        await this.updatePaymentIntent(
          event.data.object,
          PaymentStatus.requires_capture,
          { authorizedAt: new Date() },
        );
        break;
      case 'payment_intent.succeeded':
        await this.updatePaymentIntent(
          event.data.object,
          PaymentStatus.succeeded,
          {
            capturedAt: new Date(),
            stripeChargeId: this.chargeId(event.data.object.latest_charge),
          },
        );
        break;
      case 'account.updated':
        await this.updateContractor(event.data.object);
        break;
      case 'charge.dispute.created':
        await this.markDisputed(event.data.object);
        break;
      default:
        break;
    }
  }

  private async updatePaymentIntent(
    intent: Stripe.PaymentIntent,
    status: PaymentStatus,
    data: Pick<
      Prisma.PaymentUpdateInput,
      'authorizedAt' | 'capturedAt' | 'stripeChargeId'
    >,
  ): Promise<void> {
    if (intent.metadata.paymentFlow !== 'destination_charge_manual_capture') {
      return;
    }

    const result = await this.prisma.payment.updateMany({
      where: { stripePaymentIntentId: intent.id },
      data: { status, ...data },
    });
    if (result.count === 0) {
      throw new Error(`PaymentIntent ${intent.id} is not stored yet`);
    }
  }

  private async updateContractor(account: Stripe.Account): Promise<void> {
    const fixolyUserId = account.metadata?.fixolyUserId;
    if (!fixolyUserId) return;

    const result = await this.prisma.contractor.updateMany({
      where: { stripeAccountId: account.id, userId: fixolyUserId },
      data: {
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
        detailsSubmitted: account.details_submitted,
        requirementsDue: account.requirements?.currently_due ?? [],
      },
    });
    if (result.count === 0) {
      throw new Error(`Connected account ${account.id} is not stored yet`);
    }
  }

  private async markDisputed(dispute: Stripe.Dispute): Promise<void> {
    const paymentIntentId =
      typeof dispute.payment_intent === 'string'
        ? dispute.payment_intent
        : dispute.payment_intent?.id;

    if (!paymentIntentId) return;

    const result = await this.prisma.payment.updateMany({
      where: { stripePaymentIntentId: paymentIntentId },
      data: {
        status: PaymentStatus.disputed,
        disputeId: dispute.id,
      },
    });
    if (result.count === 0) {
      throw new Error(`Disputed payment ${paymentIntentId} is not stored yet`);
    }
  }

  private chargeId(charge: string | Stripe.Charge | null): string | null {
    if (!charge) return null;
    return typeof charge === 'string' ? charge : charge.id;
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }

  private errorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.slice(0, 2_000);
  }
}
