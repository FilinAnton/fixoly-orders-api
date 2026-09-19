import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Contractor } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';

export interface ContractorStatus {
  contractorId: string;
  stripeAccountId: string;
  detailsSubmitted: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  requirementsDue: string[];
  readyForPayments: boolean;
}

@Injectable()
export class ContractorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    private readonly config: ConfigService,
  ) {}

  async connect(
    userId: string,
    email: string,
    country: string,
  ): Promise<ContractorStatus> {
    const existing = await this.prisma.contractor.findUnique({
      where: { userId },
    });

    if (existing) {
      return this.refreshStatus(existing);
    }

    const account = await this.stripe.client.accounts.create(
      {
        type: 'express',
        country,
        email,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        metadata: { fixolyUserId: userId },
      },
      { idempotencyKey: `connect-account:${userId}` },
    );

    const contractor = await this.prisma.contractor.upsert({
      where: { userId },
      create: {
        userId,
        stripeAccountId: account.id,
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
        detailsSubmitted: account.details_submitted,
        requirementsDue: account.requirements?.currently_due ?? [],
      },
      update: {
        stripeAccountId: account.id,
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
        detailsSubmitted: account.details_submitted,
        requirementsDue: account.requirements?.currently_due ?? [],
      },
    });

    return this.toStatus(contractor);
  }

  async getStatus(userId: string): Promise<ContractorStatus> {
    const contractor = await this.findByUserId(userId);
    return this.refreshStatus(contractor);
  }

  async createOnboardingLink(userId: string) {
    const contractor = await this.findByUserId(userId);
    const link = await this.stripe.client.accountLinks.create({
      account: contractor.stripeAccountId,
      refresh_url: this.config.getOrThrow<string>('STRIPE_CONNECT_REFRESH_URL'),
      return_url: this.config.getOrThrow<string>('STRIPE_CONNECT_RETURN_URL'),
      type: 'account_onboarding',
    });

    return {
      url: link.url,
      expiresAt: new Date(link.expires_at * 1000).toISOString(),
    };
  }

  private async findByUserId(userId: string): Promise<Contractor> {
    const contractor = await this.prisma.contractor.findUnique({
      where: { userId },
    });

    if (!contractor) {
      throw new NotFoundException(
        'Connected account not found; create it before continuing',
      );
    }

    return contractor;
  }

  private async refreshStatus(
    contractor: Contractor,
  ): Promise<ContractorStatus> {
    const account = await this.stripe.client.accounts.retrieve(
      contractor.stripeAccountId,
    );
    const updated = await this.prisma.contractor.update({
      where: { id: contractor.id },
      data: {
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
        detailsSubmitted: account.details_submitted,
        requirementsDue: account.requirements?.currently_due ?? [],
      },
    });

    return this.toStatus(updated);
  }

  private toStatus(contractor: Contractor): ContractorStatus {
    return {
      contractorId: contractor.id,
      stripeAccountId: contractor.stripeAccountId,
      detailsSubmitted: contractor.detailsSubmitted,
      chargesEnabled: contractor.chargesEnabled,
      payoutsEnabled: contractor.payoutsEnabled,
      requirementsDue: contractor.requirementsDue,
      readyForPayments:
        contractor.detailsSubmitted &&
        contractor.chargesEnabled &&
        contractor.payoutsEnabled,
    };
  }
}
