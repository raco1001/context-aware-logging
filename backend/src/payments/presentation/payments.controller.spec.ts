import { Test, TestingModule } from "@nestjs/testing";
import { PaymentsController } from "./payments.controller";
import { PaymentsServicePort } from "@payments/in-ports";
import { LoggingUseCase } from "@logging/in-ports";
import { ContextService } from "@logging/service";
import { FinalizeMetrics } from "@logging/domain";
import { Reflector } from "@nestjs/core";
import { HttpException, HttpStatus } from "@nestjs/common";

describe("PaymentsController", () => {
  let controller: PaymentsController;

  const mockPaymentsService = {
    processPayment: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [
        { provide: PaymentsServicePort, useValue: mockPaymentsService },
        { provide: LoggingUseCase, useValue: { startRequest: jest.fn(), endRequest: jest.fn() } },
        { provide: ContextService, useValue: { addUserContext: jest.fn(), addError: jest.fn() } },
        { provide: FinalizeMetrics, useValue: { finalize: jest.fn() } },
        Reflector,
      ],
    }).compile();

    controller = module.get<PaymentsController>(PaymentsController);
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  describe("handlePayment", () => {
    const dto = {
      userId: "u1",
      role: "admin",
      amount: 100,
      product: "product1",
      count: 1,
    };

    it("should return result on success", async () => {
      const successResult = {
        success: true,
        transactionId: "t1",
        stepsReached: 3,
      };
      mockPaymentsService.processPayment.mockResolvedValue(successResult);

      const result = await controller.handlePayment(dto);
      expect(result).toBe(successResult);
    });

    it("should throw HttpException on failure", async () => {
      const failResult = {
        success: false,
        errorCode: "INSUFFICIENT_BALANCE",
        errorMessage: "Not enough funds",
        stepsReached: 1,
      };
      mockPaymentsService.processPayment.mockResolvedValue(failResult);

      await expect(controller.handlePayment(dto)).rejects.toThrow(
        HttpException,
      );
    });

    it("should throw 500 for GATEWAY_TIMEOUT", async () => {
      const failResult = {
        success: false,
        errorCode: "GATEWAY_TIMEOUT",
        errorMessage: "Timeout",
        stepsReached: 2,
      };
      mockPaymentsService.processPayment.mockResolvedValue(failResult);

      try {
        await controller.handlePayment(dto);
        fail("Expected HttpException");
      } catch (e) {
        expect(e).toBeInstanceOf(HttpException);
        expect(e.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      }
    });

    it("should throw 400 for non-timeout errors", async () => {
      const failResult = {
        success: false,
        errorCode: "INSUFFICIENT_BALANCE",
        errorMessage: "Not enough funds",
        stepsReached: 1,
      };
      mockPaymentsService.processPayment.mockResolvedValue(failResult);

      try {
        await controller.handlePayment(dto);
        fail("Expected HttpException");
      } catch (e) {
        expect(e).toBeInstanceOf(HttpException);
        expect(e.getStatus()).toBe(HttpStatus.BAD_REQUEST);
      }
    });
  });
});
