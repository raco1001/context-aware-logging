export enum PaymentErrorCode {
  INSUFFICIENT_FUNDS = 'INSUFFICIENT_FUNDS',
  GATEWAY_REJECTED = 'GATEWAY_REJECTED',
  GATEWAY_TIMEOUT = 'GATEWAY_TIMEOUT',
  CARD_EXPIRED = 'CARD_EXPIRED',
  FRAUD_DETECTION = 'FRAUD_DETECTION',
  MAINTENANCE_WINDOW = 'MAINTENANCE_WINDOW',
  ACCOUNT_LOCKED = 'ACCOUNT_LOCKED',
}

export class PaymentErrorVO {
  constructor(
    public readonly code: PaymentErrorCode,
    public readonly message: string,
  ) {}

  static readonly ERRORS: PaymentErrorVO[] = [
    new PaymentErrorVO(
      PaymentErrorCode.INSUFFICIENT_FUNDS,
      'The user has insufficient funds in their account to complete this transaction.',
    ),
    new PaymentErrorVO(
      PaymentErrorCode.GATEWAY_REJECTED,
      'The external payment gateway rejected the request due to invalid parameters or bank policy.',
    ),
    new PaymentErrorVO(
      PaymentErrorCode.GATEWAY_TIMEOUT,
      'The connection to the payment gateway timed out. Please try again later.',
    ),
    new PaymentErrorVO(
      PaymentErrorCode.CARD_EXPIRED,
      'The provided payment method has expired and cannot be processed.',
    ),
    new PaymentErrorVO(
      PaymentErrorCode.FRAUD_DETECTION,
      'Transaction flagged by the automated fraud detection system for manual review.',
    ),
    new PaymentErrorVO(
      PaymentErrorCode.MAINTENANCE_WINDOW,
      'The payment system is currently undergoing scheduled maintenance.',
    ),
    new PaymentErrorVO(
      PaymentErrorCode.ACCOUNT_LOCKED,
      'The user account is currently locked due to multiple failed login attempts or security concerns.',
    ),
  ];

  static getRandomError(): PaymentErrorVO {
    const probability = Math.random() * 100;
    if (probability < 40) return this.ERRORS[0]; // insufficient funds
    if (probability >= 40 && probability < 55) return this.ERRORS[3]; // card expired
    if (probability >= 55 && probability < 70) return this.ERRORS[1]; // gateway rejected
    if (probability >= 70 && probability < 90) return this.ERRORS[2]; // gateway timeout
    if (probability >= 90 && probability < 97) return this.ERRORS[4]; // fraud detection
    if (probability >= 97 && probability < 99) return this.ERRORS[6]; // account locked
    return this.ERRORS[5]; // maintenance window
  }
}
