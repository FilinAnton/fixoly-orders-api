import {
  Body,
  Controller,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';
import { PaymentsService } from './payments.service';

@ApiTags('payments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('create-intent')
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'Stable retry key; defaults to a key derived from orderId',
  })
  @ApiCreatedResponse({
    description: 'Manual-capture destination PaymentIntent created',
  })
  createIntent(
    @Body() dto: CreatePaymentIntentDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.payments.createIntent(dto, idempotencyKey);
  }

  @Post(':id/cancel')
  @ApiOkResponse({ description: 'Uncaptured authorization canceled' })
  cancel(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.payments.cancel(id);
  }
}
