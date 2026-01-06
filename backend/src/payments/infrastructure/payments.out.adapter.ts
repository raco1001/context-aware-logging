import { Injectable } from "@nestjs/common";
import {
  PaymentsOutPort,
  GatewayResponse,
  OrderConfirmationResponse,
} from "@payments/out-ports";
import { PaymentStatusVO } from "@payments/value-objects";

/**
 * Mock adapter for payment processing.
 *
 * Simulates a realistic multi-step payment flow using PaymentStatusVO
 * for all status/error determination. The adapter only:
 * 1. Calls PaymentStatusVO methods to determine outcomes
 * 2. Simulates appropriate latency
 * 3. Returns structured responses
 *
 * All status codes, messages, and probability distributions are
 * centralized in PaymentStatusVO.
 */
@Injectable()
export class PaymentsOutAdapter implements PaymentsOutPort {
  private readonly LATENCY = {
    BALANCE_CHECK: { min: 10, max: 50 },
    GATEWAY_NORMAL: { min: 100, max: 101 },
    GATEWAY_SLOW: { min: 2001, max: 2002 },
    GATEWAY_ERROR: { min: 1, max: 2 },
    ORDER_NORMAL: { min: 1, max: 2 },
    ORDER_SLOW: { min: 2000, max: 2001 },
  };

  async checkBalance(
    userId: string,
    amount: number,
    count: number,
  ): Promise<boolean> {
    await PaymentStatusVO.simulateLatency(
      this.LATENCY.BALANCE_CHECK.min,
      this.LATENCY.BALANCE_CHECK.max,
    );

    // Basic validation (not mock - real business rule)
    if (amount < 1 || count < 1) return false;

    // Use PaymentStatusVO to determine outcome
    const outcome = PaymentStatusVO.determineBalanceOutcome();
    return outcome.isSuccess() || outcome.isSlow();
  }

  async callGateway(userId: string, amount: number): Promise<GatewayResponse> {
    const startTime = Date.now();

    // Use PaymentStatusVO to determine outcome
    const outcome = PaymentStatusVO.determineGatewayOutcome();

    // Apply appropriate latency based on outcome
    if (outcome.isSlow()) {
      await PaymentStatusVO.simulateLatency(
        this.LATENCY.GATEWAY_SLOW.min,
        this.LATENCY.GATEWAY_SLOW.max,
      );
    } else if (outcome.isError()) {
      await PaymentStatusVO.simulateLatency(
        this.LATENCY.GATEWAY_ERROR.min,
        this.LATENCY.GATEWAY_ERROR.max,
      );
    }

    const processingTimeMs = Date.now() - startTime;

    // Handle error outcomes
    if (outcome.isError()) {
      throw new Error(
        JSON.stringify({
          code: outcome.code,
          message: outcome.message,
          service: outcome.service,
          processingTimeMs,
        }),
      );
    }

    // Success or slow success
    return {
      success: true,
      transactionId: PaymentStatusVO.generateTransactionId(),
      processingTimeMs,
    };
  }

  async confirmOrder(
    userId: string,
    transactionId: string,
    amount: number,
  ): Promise<OrderConfirmationResponse> {
    // Use PaymentStatusVO to determine outcome
    const outcome = PaymentStatusVO.determineOrderOutcome();

    // Apply appropriate latency based on outcome
    if (outcome.isSlow()) {
      await PaymentStatusVO.simulateLatency(
        this.LATENCY.ORDER_SLOW.min,
        this.LATENCY.ORDER_SLOW.max,
      );
    }

    // Handle error outcomes
    if (outcome.isError()) {
      throw new Error(
        JSON.stringify({
          code: outcome.code,
          message: outcome.message,
          service: outcome.service,
        }),
      );
    }

    // Success or slow success
    return {
      success: true,
      orderId: PaymentStatusVO.generateOrderId(),
      confirmedAt: new Date().toISOString(),
    };
  }
}
