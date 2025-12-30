import { Injectable } from "@nestjs/common";
import { PaymentsServicePort } from "@payments/in-ports";
import { PaymentsOutPort } from "@payments/out-ports";
import { PaymentRequest, PaymentResult } from "@payments/dtos";

@Injectable()
export class PaymentsService extends PaymentsServicePort {
  constructor(private readonly outPort: PaymentsOutPort) {
    super();
  }

  async processPayment(request: PaymentRequest): Promise<PaymentResult> {
    const hasBalance = await this.outPort.checkBalance(
      request.userId,
      request.amount,
      request.count,
    );
    if (!hasBalance)
      return {
        success: false,
        errorCode: "INSUFFICIENT_BALANCE",
        errorMessage: "Insufficient balance",
      };

    try {
      const gatewayRes = await this.outPort.callGateway(
        request.userId,
        request.amount,
      );
      if (!gatewayRes.success) {
        return {
          success: false,
          errorCode: "GATEWAY_REJECTED",
          errorMessage: "The gateway rejected the payment.",
        };
      }
      return { success: true, transactionId: gatewayRes.id };
    } catch (e) {
      try {
        const errorData = JSON.parse(e.message);
        return {
          success: false,
          errorCode: errorData.code,
          errorMessage: errorData.message,
        };
      } catch {
        const isTimeout = e.message.toLowerCase().includes("timeout");
        return {
          success: false,
          errorCode: isTimeout ? "GATEWAY_TIMEOUT" : "GATEWAY_ERROR",
          errorMessage: e.message,
        };
      }
    }
  }
}
