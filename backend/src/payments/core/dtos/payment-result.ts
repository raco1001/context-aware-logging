export abstract class PaymentResult {
  success: boolean;
  transactionId?: string;
  orderId?: string;
  errorCode?: string;
  errorMessage?: string;
}
