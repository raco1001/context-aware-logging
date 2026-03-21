import { Test, TestingModule } from "@nestjs/testing";
import { PaymentsService } from "@payments/service";
import { PaymentsOutPort } from "@payments/out-ports";

describe("PaymentsService", () => {
  let service: PaymentsService;

  const mockOutPort = {
    checkBalance: jest.fn(),
    callGateway: jest.fn(),
    confirmOrder: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PaymentsOutPort, useValue: mockOutPort },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("processPayment", () => {
    const request = {
      userId: "user1",
      role: "member",
      amount: 100,
      product: "product1",
      count: 1,
    };

    it("should return success when all 3 steps succeed", async () => {
      mockOutPort.checkBalance.mockResolvedValue(true);
      mockOutPort.callGateway.mockResolvedValue({
        success: true,
        transactionId: "txn_123",
        processingTimeMs: 42,
      });
      mockOutPort.confirmOrder.mockResolvedValue({
        success: true,
        orderId: "ord_456",
        confirmedAt: "2026-03-20T00:00:00Z",
      });

      const result = await service.processPayment(request);

      expect(result.success).toBe(true);
      expect(result.transactionId).toBe("txn_123");
      expect(result.orderId).toBe("ord_456");
      expect(result.stepsReached).toBe(3);
    });

    it("should return failure when balance is insufficient", async () => {
      mockOutPort.checkBalance.mockResolvedValue(false);

      const result = await service.processPayment(request);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("INSUFFICIENT_BALANCE");
      expect(result.stepsReached).toBe(1);
    });

    it("should return failure with parsed error when gateway throws", async () => {
      mockOutPort.checkBalance.mockResolvedValue(true);
      mockOutPort.callGateway.mockRejectedValue(
        new Error(
          JSON.stringify({
            code: "GATEWAY_REJECTED",
            message: "Card declined",
            service: "paymentGateway",
          }),
        ),
      );

      const result = await service.processPayment(request);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("GATEWAY_REJECTED");
      expect(result.stepsReached).toBe(2);
    });

    it("should fallback to GATEWAY_ERROR when error message is not JSON", async () => {
      mockOutPort.checkBalance.mockResolvedValue(true);
      mockOutPort.callGateway.mockRejectedValue(new Error("Timeout"));

      const result = await service.processPayment(request);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("GATEWAY_ERROR");
      expect(result.stepsReached).toBe(2);
    });
  });
});
