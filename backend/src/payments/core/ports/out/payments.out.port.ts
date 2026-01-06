/**
 * Gateway response from external payment provider.
 */
export interface GatewayResponse {
  success: boolean;
  transactionId?: string;
  processingTimeMs?: number;
}

/**
 * Order confirmation response from orders service.
 */
export interface OrderConfirmationResponse {
  success: boolean;
  orderId?: string;
  confirmedAt?: string;
}

/**
 * PaymentsOutPort - Outbound port for payment processing.
 *
 * Represents the multi-step payment flow:
 * 1. checkBalance (internal validation)
 * 2. callGateway (external PG provider)
 * 3. confirmOrder (internal orders service)
 */
export abstract class PaymentsOutPort {
  /**
   * Step 1: Internal balance validation.
   * Service: payments
   */
  abstract checkBalance(
    userId: string,
    amount: number,
    count: number,
  ): Promise<boolean>;

  /**
   * Step 2: External payment gateway call.
   * Service: paymentGateway (external)
   * May be slow (network latency) or fail (provider issues).
   */
  abstract callGateway(
    userId: string,
    amount: number,
  ): Promise<GatewayResponse>;

  /**
   * Step 3: Confirm order after successful payment.
   * Service: orders (internal)
   * Updates order status from 'pending' to 'confirmed'.
   */
  abstract confirmOrder(
    userId: string,
    transactionId: string,
    amount: number,
  ): Promise<OrderConfirmationResponse>;
}
