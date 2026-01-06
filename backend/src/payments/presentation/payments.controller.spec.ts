import { Test, TestingModule } from "@nestjs/testing";
import { PaymentsController } from "./payments.controller";
import { PaymentsService } from "@payments/service";
import { LoggingService } from "@logging/service";
import { HttpException, HttpStatus } from "@nestjs/common";

describe("PaymentsController", () => {
  let controller: PaymentsController;
  let service: PaymentsService;
  let loggingService: LoggingService;

  const mockPaymentsService = {
    processPayment: jest.fn(),
  };

  const mockLoggingService = {
    addUserContext: jest.fn(),
    addError: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [
        { provide: PaymentsService, useValue: mockPaymentsService },
        { provide: LoggingService, useValue: mockLoggingService },
      ],
    }).compile();

    controller = module.get<PaymentsController>(PaymentsController);
    service = module.get<PaymentsService>(PaymentsService);
    loggingService = module.get<LoggingService>(LoggingService);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  describe("handlePayment", () => {
    it("should add user context and return service result on success", async () => {
      const dto = {
        userId: "u1",
        role: "admin",
        amount: 100,
        product: "product1",
        count: 1,
      };
      const successResult = { success: true, transactionId: "t1" };
      mockPaymentsService.processPayment.mockResolvedValue(successResult);

      const result = await controller.handlePayment(dto);

      expect(loggingService.addUserContext).toHaveBeenCalledWith({
        id: "u1",
        role: "admin",
      });
      expect(result).toBe(successResult);
    });

    it("should throw HttpException and add error context on failure", async () => {
      const dto = {
        userId: "u1",
        role: "admin",
        amount: 100,
        product: "product1",
        count: 1,
      };
      const failResult = {
        success: false,
        errorCode: "ERR",
        errorMessage: "Msg",
      };
      mockPaymentsService.processPayment.mockResolvedValue(failResult);

      await expect(controller.handlePayment(dto)).rejects.toThrow(
        HttpException,
      );

      expect(loggingService.addError).toHaveBeenCalledWith({
        code: "ERR",
        message: "Msg",
      });
    });

    it("should throw 500 for GATEWAY_TIMEOUT", async () => {
      const dto = {
        userId: "u1",
        role: "admin",
        amount: 100,
        product: "product1",
        count: 1,
      };
      const failResult = {
        success: false,
        errorCode: "GATEWAY_TIMEOUT",
        errorMessage: "Timeout",
      };
      mockPaymentsService.processPayment.mockResolvedValue(failResult);

      try {
        await controller.handlePayment(dto);
      } catch (e) {
        expect(e).toBeInstanceOf(HttpException);
        expect(e.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      }
    });
  });
});
