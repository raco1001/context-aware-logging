import { Injectable } from "@nestjs/common";
import { PaymentsServicePort } from "@payments/in-ports";
import { PaymentsOutPort } from "@payments/out-ports";
import { PaymentRequest, PaymentResult } from "@payments/dtos";
import { PaymentStatusVO, PaymentStatusCode } from "@payments/value-objects";

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
 * - Return results with all metadata for logging (via @LogResponseMeta)
 * - Pass through adapter results without modification
 *
 * Logging is handled declaratively by LoggingInterceptor using decorators.
 * This service returns all relevant metadata in PaymentResult for extraction.
 *
 * All status codes, messages, and business logic are delegated to:
 * - PaymentStatusVO: Status definitions and outcome determination
 * - PaymentsOutAdapter: External/mock service calls
 */
@Injectable()
export class PaymentsService extends PaymentsServicePort {
  constructor(private readonly outPort: PaymentsOutPort) {
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
        errorService: "payments",
      };
    }

    // Step 2: Payment Gateway Call (service: paymentGateway)
    let transactionId: string;
    let gatewayProcessingTimeMs: number | undefined;

    try {
      const gatewayRes = await this.outPort.callGateway(
        request.userId,
        request.amount,
      );

      transactionId = gatewayRes.transactionId!;
      gatewayProcessingTimeMs = gatewayRes.processingTimeMs;
    } catch (e) {
      const error = this.parseAdapterError(e as Error);
      return {
        success: false,
        errorCode: error.code,
        errorMessage: error.message,
        errorService: error.service || "paymentGateway",
      };
    }

    // Step 3: Order Confirmation (service: orders)
    try {
      const orderRes = await this.outPort.confirmOrder(
        request.userId,
        transactionId,
        request.amount,
      );

      return {
        success: true,
        transactionId,
        orderId: orderRes.orderId,
        gatewayProcessingTimeMs,
        confirmedAt: orderRes.confirmedAt,
      };
    } catch (e) {
      const error = this.parseAdapterError(e as Error);
      return {
        success: false,
        errorCode: error.code,
        errorMessage: error.message,
        errorService: error.service || "orders",
        gatewayProcessingTimeMs,
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
