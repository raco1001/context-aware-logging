import { PaymentRequest, PaymentResult } from "@payments/dtos";

export abstract class PaymentsServicePort {
  abstract processPayment(request: PaymentRequest): Promise<PaymentResult>;
}
