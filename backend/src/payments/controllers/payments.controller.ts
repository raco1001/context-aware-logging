import {
  Controller,
  Post,
  Body,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { PaymentsService } from '../services/payments.service';
import { PaymentRequest } from '../core/domain/dtos/payment-request';
import { LoggingService } from '../../../libs/logging';

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly loggingService: LoggingService,
  ) {}

  @Post()
  async handlePayment(@Body() dto: PaymentRequest) {
    // 1. Pre-fill user context
    this.loggingService.addUserContext({ id: dto.userId, role: dto.role });

    // 2. Add domain-specific metadata (Product information)
    this.loggingService.addMetadata({
      product: dto.product,
      count: dto.count,
      amount: dto.amount,
    });

    const result = await this.paymentsService.processPayment(dto);

    if (!result.success) {
      // 3. Pre-fill error context
      this.loggingService.addError({
        code: result.errorCode || 'UNKNOWN_PAYMENT_ERROR',
        message: result.errorMessage || 'Payment failed',
      });

      const status =
        result.errorCode === 'GATEWAY_TIMEOUT'
          ? HttpStatus.INTERNAL_SERVER_ERROR
          : HttpStatus.BAD_REQUEST;

      throw new HttpException(result, status);
    }

    return result;
  }
}
