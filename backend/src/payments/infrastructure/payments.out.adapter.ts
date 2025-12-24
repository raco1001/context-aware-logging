import { Injectable } from '@nestjs/common';
import { PaymentsOutPort } from '../core/ports/out/payments.out.port';
import { PaymentErrorVO } from '../core/domain/value-objects/payment-errors.vo';

@Injectable()
export class PaymentsOutAdapter implements PaymentsOutPort {
  async checkBalance(
    userId: string,
    amount: number,
    count: number,
  ): Promise<boolean> {
    if (amount < 1 || count < 1) return false;

    return true;
  }

  async callGateway(
    userId: string,
    amount: number,
  ): Promise<{ success: boolean; id?: string }> {
    await new Promise((res) => setTimeout(res, 100));

    const random = Math.random() * 100;

    // 70% Success, 30% Failure
    if (random > 70) {
      const error = PaymentErrorVO.getRandomError();
      throw new Error(
        JSON.stringify({ code: error.code, message: error.message }),
      );
    }

    return {
      success: true,
      id: `txn_${Math.random().toString(36).substr(2, 9)}`,
    };
  }
}
