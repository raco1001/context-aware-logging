import { Module } from '@nestjs/common';
import { PaymentsController } from '@payments/presentation/index';
import { PaymentsService } from '@payments/services/index';
import { PaymentsOutAdapter } from '@payments/infrastructure/index';
import { PaymentsOutPort } from '@payments/out-ports/index';
import { PaymentsServicePort } from '@payments/in-ports/index';

@Module({
  controllers: [PaymentsController],
  providers: [
    { provide: PaymentsServicePort, useClass: PaymentsService },
    { provide: PaymentsOutPort, useClass: PaymentsOutAdapter },
  ],
})
export class PaymentsModule {}
