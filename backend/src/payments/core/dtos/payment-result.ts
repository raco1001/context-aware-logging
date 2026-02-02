export abstract class PaymentResult {
  success: boolean;
  transactionId?: string;
  orderId?: string;
  errorCode?: string;
  errorMessage?: string;

  /**
   * Additional metadata for logging/debugging (extracted by @LogResponseMeta)
   */
  /** Processing time from payment gateway (ms) */
  gatewayProcessingTimeMs?: number;
  /** Order confirmation timestamp */
  confirmedAt?: string;
  /** Service that caused the error (for debugging multi-step flows) */
  errorService?: string;
}
