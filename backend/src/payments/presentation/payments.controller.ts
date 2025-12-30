import {
  Controller,
  Post,
  Body,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { PaymentsServicePort } from "@payments/in-ports/index";
import { PaymentRequest } from "@payments/dtos/index";
import { LoggingService } from "@logging/services/index";
import { Service } from "@logging/presentation/service.decorator";

@Controller("payments")
@Service("payments")
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsServicePort,
    private readonly loggingService: LoggingService,
  ) {}

  @Post()
  async handlePayment(@Body() dto: PaymentRequest) {
    this.loggingService.addUserContext({ id: dto.userId, role: dto.role });

    this.loggingService.addMetadata({
      product: dto.product,
      count: dto.count,
      amount: dto.amount,
    });

    const result = await this.paymentsService.processPayment(dto);

    if (!result.success) {
      this.loggingService.addError({
        code: result.errorCode || "UNKNOWN_PAYMENT_ERROR",
        message: result.errorMessage || "Payment failed",
      });

      const status =
        result.errorCode === "GATEWAY_TIMEOUT"
          ? HttpStatus.INTERNAL_SERVER_ERROR
          : HttpStatus.BAD_REQUEST;

      throw new HttpException(result, status);
    }

    return result;
  }
}
