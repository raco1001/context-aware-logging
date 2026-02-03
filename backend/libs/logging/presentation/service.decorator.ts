import { SetMetadata } from '@nestjs/common';

/**
 * Service decorator - Sets the service name for logging purposes.
 * This allows each module to identify itself in logs.
 *
 * @param serviceName The name of the service/module (e.g., 'payments', 'embeddings')
 *
 * @example
 * ```typescript
 * @Controller('payments')
 * @Service('payments')
 * export class PaymentsController { ... }
 * ```
 */
export const Service = (serviceName: string) =>
  SetMetadata('service', serviceName);
