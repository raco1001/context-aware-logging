import { Injectable } from '@nestjs/common';
import { PaymentsServicePort } from '../core/ports/in/payments.service.port';
import { PaymentsOutPort } from '../core/ports/out/payments.out.port';
import { PaymentRequest } from '../core/domain/dtos/payment-request';
import { PaymentResult } from '../core/domain/dtos/payment-result';

@Injectable()
export class PaymentsService implements PaymentsServicePort {
  constructor(private readonly outPort: PaymentsOutPort) {}

  async processPayment(request: PaymentRequest): Promise<PaymentResult> {
    const hasBalance = await this.outPort.checkBalance(
      request.userId,
      request.amount,
      request.count,
    );
    if (!hasBalance)
      return {
        success: false,
        errorCode: 'INSUFFICIENT_BALANCE',
        errorMessage: 'Insufficient balance',
      };

    try {
      const gatewayRes = await this.outPort.callGateway(
        request.userId,
        request.amount,
      );
      if (!gatewayRes.success) {
        return {
          success: false,
          errorCode: 'GATEWAY_REJECTED',
          errorMessage: 'The gateway rejected the payment.',
        };
      }
      return { success: true, transactionId: gatewayRes.id };
    } catch (e) {
      try {
        // Try to parse the rich error object from the infrastructure layer
        const errorData = JSON.parse(e.message);
        return {
          success: false,
          errorCode: errorData.code,
          errorMessage: errorData.message,
        };
      } catch {
        // Fallback for plain error messages
        const isTimeout = e.message.toLowerCase().includes('timeout');
        return {
          success: false,
          errorCode: isTimeout ? 'GATEWAY_TIMEOUT' : 'GATEWAY_ERROR',
          errorMessage: e.message,
        };
      }
    }
  }
}
