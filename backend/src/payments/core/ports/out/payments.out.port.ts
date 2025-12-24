export abstract class PaymentsOutPort {
  abstract checkBalance(
    userId: string,
    amount: number,
    count: number,
  ): Promise<boolean>;
  abstract callGateway(
    userId: string,
    amount: number,
  ): Promise<{ success: boolean; id?: string }>;
}
