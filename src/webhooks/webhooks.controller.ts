import {
  BadRequestException,
  Controller,
  Headers,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { WebhooksService } from './webhooks.service';

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Post('stripe')
  @ApiHeader({ name: 'stripe-signature', required: true })
  @ApiOkResponse({ description: 'Signed Stripe event accepted' })
  stripe(
    @Req() request: RawBodyRequest<object>,
    @Headers('stripe-signature') signature?: string,
  ) {
    if (!signature || !request.rawBody) {
      throw new BadRequestException(
        'Stripe signature and unparsed request body are required',
      );
    }

    return this.webhooks.processStripeEvent(request.rawBody, signature);
  }
}
