/**
 * Payment process status codes.
 * Categorized by severity: ERROR (failure), WARN (slow but success), NORMAL (success).
 */
export enum PaymentStatusCode {
  // ============ NORMAL (Success) ============
  SUCCESS = "SUCCESS",

  // ============ WARN (Slow but Success) ============
  SLOW_GATEWAY_SUCCESS = "SLOW_GATEWAY_SUCCESS",
  SLOW_ORDER_SUCCESS = "SLOW_ORDER_SUCCESS",

  // ============ ERROR (Failure) ============
  // Step 1: Balance Check (service: payments)
  INSUFFICIENT_BALANCE = "INSUFFICIENT_BALANCE",

  // Step 2: Payment Gateway (service: paymentGateway)
  INSUFFICIENT_FUNDS = "INSUFFICIENT_FUNDS",
  GATEWAY_REJECTED = "GATEWAY_REJECTED",
  GATEWAY_TIMEOUT = "GATEWAY_TIMEOUT",
  GATEWAY_ERROR = "GATEWAY_ERROR",
  CARD_EXPIRED = "CARD_EXPIRED",
  FRAUD_DETECTION = "FRAUD_DETECTION",
  MAINTENANCE_WINDOW = "MAINTENANCE_WINDOW",
  ACCOUNT_LOCKED = "ACCOUNT_LOCKED",

  // Step 3: Order Confirmation (service: orders)
  ORDER_CONFIRMATION_FAILED = "ORDER_CONFIRMATION_FAILED",
  ORDER_ERROR = "ORDER_ERROR",
}

/**
 * Status severity levels for sampling and alerting decisions.
 */
export enum StatusSeverity {
  NORMAL = "NORMAL",
  WARN = "WARN",
  ERROR = "ERROR",
}

/**
 * Service where the status originated.
 */
export enum PaymentServiceStep {
  PAYMENTS = "payments",
  PAYMENT_GATEWAY = "paymentGateway",
  ORDERS = "orders",
}

/**
 * Payment status value object.
 * Encapsulates code, message, severity, and originating service.
 */
export class PaymentStatusVO {
  constructor(
    public readonly code: PaymentStatusCode,
    public readonly message: string,
    public readonly severity: StatusSeverity,
    public readonly service: PaymentServiceStep,
  ) {}

  /**
   * Generate a mock transaction ID.
   */
  static generateTransactionId(): string {
    return `txn_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  /**
   * Generate a mock order ID.
   */
  static generateOrderId(): string {
    return `ord_${Math.random().toString(36).slice(2, 11)}`;
  }
  /**
   * Check if this status represents an error.
   */
  isError(): boolean {
    return this.severity === StatusSeverity.ERROR;
  }

  /**
   * Check if this status represents a slow (but successful) operation.
   */
  isSlow(): boolean {
    return this.severity === StatusSeverity.WARN;
  }

  /**
   * Check if this status represents a normal success.
   */
  isSuccess(): boolean {
    return this.severity === StatusSeverity.NORMAL;
  }

  // ============ Status Registry ============
  static readonly STATUS: PaymentStatusVO[] = [
    // ---- NORMAL ----
    new PaymentStatusVO(
      PaymentStatusCode.SUCCESS,
      "Payment processed successfully.",
      StatusSeverity.NORMAL,
      PaymentServiceStep.PAYMENTS,
    ),

    // ---- WARN (Slow) ----
    new PaymentStatusVO(
      PaymentStatusCode.SLOW_GATEWAY_SUCCESS,
      "Payment gateway responded slowly but transaction completed successfully.",
      StatusSeverity.WARN,
      PaymentServiceStep.PAYMENT_GATEWAY,
    ),
    new PaymentStatusVO(
      PaymentStatusCode.SLOW_ORDER_SUCCESS,
      "Order confirmation was slow but completed successfully.",
      StatusSeverity.WARN,
      PaymentServiceStep.ORDERS,
    ),

    // ---- ERROR: Balance Check (payments) ----
    new PaymentStatusVO(
      PaymentStatusCode.INSUFFICIENT_BALANCE,
      "User does not have sufficient balance for this transaction.",
      StatusSeverity.ERROR,
      PaymentServiceStep.PAYMENTS,
    ),

    // ---- ERROR: Gateway (paymentGateway) ----
    new PaymentStatusVO(
      PaymentStatusCode.INSUFFICIENT_FUNDS,
      "The user has insufficient funds in their account to complete this transaction.",
      StatusSeverity.ERROR,
      PaymentServiceStep.PAYMENT_GATEWAY,
    ),
    new PaymentStatusVO(
      PaymentStatusCode.GATEWAY_REJECTED,
      "The external payment gateway rejected the request due to invalid parameters or bank policy.",
      StatusSeverity.ERROR,
      PaymentServiceStep.PAYMENT_GATEWAY,
    ),
    new PaymentStatusVO(
      PaymentStatusCode.GATEWAY_TIMEOUT,
      "The connection to the payment gateway timed out. Please try again later.",
      StatusSeverity.ERROR,
      PaymentServiceStep.PAYMENT_GATEWAY,
    ),
    new PaymentStatusVO(
      PaymentStatusCode.GATEWAY_ERROR,
      "An unexpected error occurred while communicating with the payment gateway.",
      StatusSeverity.ERROR,
      PaymentServiceStep.PAYMENT_GATEWAY,
    ),
    new PaymentStatusVO(
      PaymentStatusCode.CARD_EXPIRED,
      "The provided payment method has expired and cannot be processed.",
      StatusSeverity.ERROR,
      PaymentServiceStep.PAYMENT_GATEWAY,
    ),
    new PaymentStatusVO(
      PaymentStatusCode.FRAUD_DETECTION,
      "Transaction flagged by the automated fraud detection system for manual review.",
      StatusSeverity.ERROR,
      PaymentServiceStep.PAYMENT_GATEWAY,
    ),
    new PaymentStatusVO(
      PaymentStatusCode.MAINTENANCE_WINDOW,
      "The payment system is currently undergoing scheduled maintenance.",
      StatusSeverity.ERROR,
      PaymentServiceStep.PAYMENT_GATEWAY,
    ),
    new PaymentStatusVO(
      PaymentStatusCode.ACCOUNT_LOCKED,
      "The user account is currently locked due to multiple failed login attempts or security concerns.",
      StatusSeverity.ERROR,
      PaymentServiceStep.PAYMENT_GATEWAY,
    ),

    // ---- ERROR: Order Confirmation (orders) ----
    new PaymentStatusVO(
      PaymentStatusCode.ORDER_CONFIRMATION_FAILED,
      "Failed to confirm order. The order service is temporarily unavailable.",
      StatusSeverity.ERROR,
      PaymentServiceStep.ORDERS,
    ),
    new PaymentStatusVO(
      PaymentStatusCode.ORDER_ERROR,
      "An unexpected error occurred in the order service.",
      StatusSeverity.ERROR,
      PaymentServiceStep.ORDERS,
    ),
  ];

  // ============ Lookup Methods ============

  /**
   * Get a status by its code.
   */
  static getByCode(code: PaymentStatusCode): PaymentStatusVO {
    const status = this.STATUS.find((s) => s.code === code);
    if (!status) {
      throw new Error(`Unknown payment status code: ${code}`);
    }
    return status;
  }

  /**
   * Get the SUCCESS status.
   */
  static success(): PaymentStatusVO {
    return this.getByCode(PaymentStatusCode.SUCCESS);
  }

  /**
   * Get the SLOW_GATEWAY_SUCCESS status.
   */
  static slowGatewaySuccess(): PaymentStatusVO {
    return this.getByCode(PaymentStatusCode.SLOW_GATEWAY_SUCCESS);
  }

  /**
   * Get the SLOW_ORDER_SUCCESS status.
   */
  static slowOrderSuccess(): PaymentStatusVO {
    return this.getByCode(PaymentStatusCode.SLOW_ORDER_SUCCESS);
  }

  // ============ Random Selection for Mocking ============

  /**
   * Simulate network/processing latency.
   */
  static async simulateLatency(minMs: number, maxMs: number): Promise<void> {
    const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  /**
   * Get a random gateway error status based on probability distribution.
   *
   * Distribution:
   * - 40% INSUFFICIENT_FUNDS
   * - 15% CARD_EXPIRED
   * - 15% GATEWAY_REJECTED
   * - 20% GATEWAY_TIMEOUT
   * - 7% FRAUD_DETECTION
   * - 2% ACCOUNT_LOCKED
   * - 1% MAINTENANCE_WINDOW
   */
  static getRandomGatewayError(): PaymentStatusVO {
    const probability = Math.random() * 100;

    if (probability < 40)
      return this.getByCode(PaymentStatusCode.INSUFFICIENT_FUNDS);
    if (probability < 55) return this.getByCode(PaymentStatusCode.CARD_EXPIRED);
    if (probability < 70)
      return this.getByCode(PaymentStatusCode.GATEWAY_REJECTED);
    if (probability < 90)
      return this.getByCode(PaymentStatusCode.GATEWAY_TIMEOUT);
    if (probability < 97)
      return this.getByCode(PaymentStatusCode.FRAUD_DETECTION);
    if (probability < 99)
      return this.getByCode(PaymentStatusCode.ACCOUNT_LOCKED);
    return this.getByCode(PaymentStatusCode.MAINTENANCE_WINDOW);
  }

  /**
   * Determine gateway call outcome based on probability.
   *
   * Returns:
   * - 10%: SLOW_GATEWAY_SUCCESS (slow but success)
   * - 60%: SUCCESS (normal success)
   * - 30%: Random gateway error
   */
  static determineGatewayOutcome(): PaymentStatusVO {
    const random = Math.random() * 100;

    if (random < 5) return this.slowGatewaySuccess();
    if (random < 94.9) return this.success();
    return this.getRandomGatewayError();
  }

  /**
   * Determine order confirmation outcome based on probability.
   *
   * Returns:
   * - 5%: SLOW_ORDER_SUCCESS (slow but success)
   * - 94.9%: SUCCESS (normal success)
   * - 0.1%: ORDER_CONFIRMATION_FAILED
   */
  static determineOrderOutcome(): PaymentStatusVO {
    const random = Math.random() * 100;

    if (random < 5) return this.slowOrderSuccess();
    if (random < 94.9) return this.success();
    return this.getByCode(PaymentStatusCode.ORDER_CONFIRMATION_FAILED);
  }

  /**
   * Determine balance check outcome.
   *
   * Returns:
   * - 5%: INSUFFICIENT_BALANCE
   * - 95%: SUCCESS
   */
  static determineBalanceOutcome(): PaymentStatusVO {
    const random = Math.random() * 100;
    if (random <= 5) {
      return this.getByCode(PaymentStatusCode.INSUFFICIENT_BALANCE);
    }
    return this.success();
  }
}
