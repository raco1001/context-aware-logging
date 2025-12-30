import { PaymentRequest, PaymentResult } from '@payments/dtos/index';

export abstract class PaymentsServicePort {
  abstract processPayment(request: PaymentRequest): Promise<PaymentResult>;
}
