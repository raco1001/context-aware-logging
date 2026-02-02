import {
  Controller,
  Post,
  Body,
  HttpException,
  HttpStatus,
  UseInterceptors,
} from "@nestjs/common";
import { PaymentsServicePort } from "@payments/in-ports";
import { PaymentRequest } from "@payments/dtos";
import {
  LoggingInterceptor,
  Service,
  LogUser,
  LogRequestMeta,
  LogResponseMeta,
  LogSamplingHint,
} from "@logging/presentation";

/**
 * PaymentsController - Handles payment requests.
 *
 * Logging is now fully declarative via decorators:
 * - @LogUser extracts user context from request body
 * - @LogRequestMeta extracts specified fields for logging
 * - @LogResponseMeta extracts all response fields including metadata
 * - @LogSamplingHint marks as critical for 100% sampling
 *
 * The LoggingInterceptor automatically applies these policies.
 * PaymentsService returns all metadata in PaymentResult for extraction.
 */
@Controller("payments")
@Service("payments")
@UseInterceptors(LoggingInterceptor)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsServicePort) {}

  @Post()
  @LogUser({ id: "body.userId", role: "body.role" })
  @LogRequestMeta(["body.product", "body.count", "body.amount"])
  @LogResponseMeta([
    "success",
    "transactionId",
    "orderId",
    "gatewayProcessingTimeMs",
    "confirmedAt",
    "errorService",
    "errorCode",
  ])
  @LogSamplingHint("critical")
  async handlePayment(@Body() dto: PaymentRequest) {
    const result = await this.paymentsService.processPayment(dto);

    if (!result.success) {
      // Business error - throw HttpException for interceptor to capture
      const status =
        result.errorCode === "GATEWAY_TIMEOUT"
          ? HttpStatus.INTERNAL_SERVER_ERROR
          : HttpStatus.BAD_REQUEST;

      throw new HttpException(
        {
          errorCode: result.errorCode || "UNKNOWN_PAYMENT_ERROR",
          errorMessage: result.errorMessage || "Payment failed",
          ...result,
        },
        status,
      );
    }

    return result;
  }
}
