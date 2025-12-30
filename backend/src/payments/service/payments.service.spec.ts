import { Test, TestingModule } from "@nestjs/testing";
import { PaymentsService } from "@payments/service";
import { PaymentsOutPort } from "@payments/out-ports";

describe("PaymentsService", () => {
  let service: PaymentsService;
  let outPort: PaymentsOutPort;

  const mockOutPort = {
    checkBalance: jest.fn(),
    callGateway: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PaymentsOutPort, useValue: mockOutPort },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
    outPort = module.get<PaymentsOutPort>(PaymentsOutPort);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("processPayment", () => {
    it("should return success when balance and gateway call are successful", async () => {
      mockOutPort.checkBalance.mockResolvedValue(true);
      mockOutPort.callGateway.mockResolvedValue({
        success: true,
        id: "txn_123",
      });

      const result = await service.processPayment({
        userId: "user1",
        role: "member",
        amount: 100,
        product: "product1",
        count: 1,
      });

      expect(result.success).toBe(true);
      expect(result.transactionId).toBe("txn_123");
    });

    it("should return failure when balance is insufficient", async () => {
      mockOutPort.checkBalance.mockResolvedValue(false);

      const result = await service.processPayment({
        userId: "user1",
        role: "member",
        amount: 100,
        product: "product1",
        count: 1,
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("INSUFFICIENT_BALANCE");
    });

    it("should return failure when gateway rejects", async () => {
      mockOutPort.checkBalance.mockResolvedValue(true);
      mockOutPort.callGateway.mockResolvedValue({
        success: false,
        error: "Rejected",
      });

      const result = await service.processPayment({
        userId: "user1",
        role: "member",
        amount: 100,
        product: "product1",
        count: 1,
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("GATEWAY_REJECTED");
    });

    it("should return failure when gateway call throws error", async () => {
      mockOutPort.checkBalance.mockResolvedValue(true);
      mockOutPort.callGateway.mockRejectedValue(new Error("Timeout"));

      const result = await service.processPayment({
        userId: "user1",
        role: "member",
        amount: 100,
        product: "product1",
        count: 1,
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("GATEWAY_TIMEOUT");
    });
  });
});
