import { Injectable } from "@nestjs/common";
import { PaymentsServicePort } from "@payments/in-ports";
import { PaymentsOutPort } from "@payments/out-ports";
import { PaymentRequest, PaymentResult } from "@payments/dtos";
import { PaymentStatusVO, PaymentStatusCode } from "@payments/value-objects";
import { LoggingService } from "@logging/service";

/**
 * Parsed error structure from adapter exceptions.
 */
interface AdapterError {
  code: string;
  message: string;
  service?: string;
  processingTimeMs?: number;
}

/**
 * PaymentsService - Orchestrates the multi-step payment flow.
 *
 * Responsibilities:
 * - Coordinate the payment processing steps
 * - Update logging context with appropriate service at each step
 * - Pass through adapter results without modification
 *
 * All status codes, messages, and business logic are delegated to:
 * - PaymentStatusVO: Status definitions and outcome determination
 * - PaymentsOutAdapter: External/mock service calls
 */
@Injectable()
export class PaymentsService extends PaymentsServicePort {
  constructor(
    private readonly outPort: PaymentsOutPort,
    private readonly loggingService: LoggingService,
  ) {
    super();
  }

  async processPayment(request: PaymentRequest): Promise<PaymentResult> {
    // Step 1: Balance Check (service: payments)
    const hasBalance = await this.outPort.checkBalance(
      request.userId,
      request.amount,
      request.count,
    );

    if (!hasBalance) {
      const status = PaymentStatusVO.getByCode(
        PaymentStatusCode.INSUFFICIENT_BALANCE,
      );
      return {
        success: false,
        errorCode: status.code,
        errorMessage: status.message,
      };
    }

    // Step 2: Payment Gateway Call (service: paymentGateway)
    this.loggingService.setService("paymentGateway");

    let transactionId: string;
    try {
      const gatewayRes = await this.outPort.callGateway(
        request.userId,
        request.amount,
      );

      transactionId = gatewayRes.transactionId!;

      if (gatewayRes.processingTimeMs) {
        this.loggingService.addMetadata({
          gatewayProcessingTimeMs: gatewayRes.processingTimeMs,
        });
      }
    } catch (e) {
      const error = this.parseAdapterError(e as Error);
      if (error.service) {
        this.loggingService.setService(error.service);
      }
      return {
        success: false,
        errorCode: error.code,
        errorMessage: error.message,
      };
    }

    // Step 3: Order Confirmation (service: orders)
    this.loggingService.setService("orders");

    try {
      const orderRes = await this.outPort.confirmOrder(
        request.userId,
        transactionId,
        request.amount,
      );

      this.loggingService.addMetadata({
        orderId: orderRes.orderId,
        confirmedAt: orderRes.confirmedAt,
      });

      this.loggingService.setService("payments");

      return {
        success: true,
        transactionId,
        orderId: orderRes.orderId,
      };
    } catch (e) {
      const error = this.parseAdapterError(e as Error);
      if (error.service) {
        this.loggingService.setService(error.service);
      }
      return {
        success: false,
        errorCode: error.code,
        errorMessage: error.message,
      };
    }
  }

  /**
   * Parse error thrown by adapter.
   * Adapter errors are JSON-serialized PaymentStatusVO data.
   */
  private parseAdapterError(e: Error): AdapterError {
    try {
      return JSON.parse(e.message) as AdapterError;
    } catch {
      return {
        code: PaymentStatusCode.GATEWAY_ERROR,
        message: e.message,
      };
    }
  }
}
