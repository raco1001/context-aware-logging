import { Module } from '@nestjs/common';
import { PaymentsController } from './controllers/payments.controller';
import { PaymentsService } from './services/payments.service';
import { PaymentsOutAdapter } from './infrastructure/payments.out.adapter';
import { PaymentsOutPort } from './core/ports/out/payments.out.port';

@Module({
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    { provide: PaymentsOutPort, useClass: PaymentsOutAdapter },
  ],
})
export class PaymentsModule {}

