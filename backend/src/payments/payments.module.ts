import { Module } from "@nestjs/common";
import { PaymentsController } from "@payments/presentation";
import { PaymentsService } from "@payments/service";
import { PaymentsOutAdapter } from "@payments/infrastructure";
import { PaymentsOutPort } from "@payments/out-ports";
import { PaymentsServicePort } from "@payments/in-ports";

@Module({
  controllers: [PaymentsController],
  providers: [
    { provide: PaymentsServicePort, useClass: PaymentsService },
    { provide: PaymentsOutPort, useClass: PaymentsOutAdapter },
  ],
})
export class PaymentsModule {}
