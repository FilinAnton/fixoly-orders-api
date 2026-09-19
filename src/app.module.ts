import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { ContractorsModule } from './contractors/contractors.module';
import { OrdersModule } from './orders/orders.module';
import { PaymentsModule } from './payments/payments.module';
import { PrismaModule } from './prisma/prisma.module';
import { StripeModule } from './stripe/stripe.module';
import { WebhooksModule } from './webhooks/webhooks.module';

function validateEnvironment(config: Record<string, unknown>) {
  const databaseUrl = config.DATABASE_URL;
  const jwtSecret = config.JWT_SECRET;
  const stripeSecretKey = config.STRIPE_SECRET_KEY;
  const stripeWebhookSecret = config.STRIPE_WEBHOOK_SECRET;

  if (
    typeof databaseUrl !== 'string' ||
    !databaseUrl.startsWith('postgresql://')
  ) {
    throw new Error('DATABASE_URL must be a PostgreSQL connection string');
  }

  if (typeof jwtSecret !== 'string' || jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must contain at least 32 characters');
  }

  if (
    typeof stripeSecretKey !== 'string' ||
    !stripeSecretKey.startsWith('sk_test_')
  ) {
    throw new Error('STRIPE_SECRET_KEY must be a Stripe test-mode secret key');
  }

  if (
    typeof stripeWebhookSecret !== 'string' ||
    !stripeWebhookSecret.startsWith('whsec_')
  ) {
    throw new Error('STRIPE_WEBHOOK_SECRET must be a Stripe webhook secret');
  }

  for (const name of [
    'STRIPE_CONNECT_REFRESH_URL',
    'STRIPE_CONNECT_RETURN_URL',
  ]) {
    try {
      new URL(String(config[name]));
    } catch {
      throw new Error(`${name} must be an absolute URL`);
    }
  }

  const expiresIn = Number(config.JWT_EXPIRES_IN_SECONDS ?? 3600);
  if (!Number.isInteger(expiresIn) || expiresIn <= 0) {
    throw new Error('JWT_EXPIRES_IN_SECONDS must be a positive integer');
  }

  return config;
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnvironment,
    }),
    PrismaModule,
    StripeModule,
    AuthModule,
    ContractorsModule,
    PaymentsModule,
    OrdersModule,
    WebhooksModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
