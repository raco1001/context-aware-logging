import { PaymentRequest } from '../../domain/dtos/payment-request';
import { PaymentResult } from '../../domain/dtos/payment-result';

export abstract class PaymentsServicePort {
  abstract processPayment(request: PaymentRequest): Promise<PaymentResult>;
}
