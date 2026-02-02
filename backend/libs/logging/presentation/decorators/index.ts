/**
 * Logging Decorators - Declarative logging configuration for controllers/handlers
 *
 * These decorators allow you to specify what information should be logged
 * without writing imperative logging code in your business logic.
 *
 * @example Complete usage
 * ```typescript
 * @Controller('orders')
 * @Service('orders')
 * export class OrdersController {
 *   @Post()
 *   @LogUser({ id: 'body.userId', role: 'body.role' })
 *   @LogRequestMeta(['body.product', 'body.amount'])
 *   @LogResponseMeta(['orderId', 'status'])
 *   @LogRedact(['body.cardNumber'])
 *   @LogSamplingHint('critical')
 *   async createOrder(@Body() dto: CreateOrderDto) {
 *     // Pure business logic - no logging code needed
 *     return this.orderService.create(dto);
 *   }
 *
 *   @Get('health')
 *   @NoLog()
 *   healthCheck() {
 *     return { status: 'ok' };
 *   }
 * }
 * ```
 */

// User context decorators
export {
  LogUser,
  LogUserFromRequest,
  LogUserConfig,
  LOG_USER_KEY,
  LOG_USER_FROM_REQUEST_KEY,
} from "./log-user.decorator";

// Request/Response meta decorators
export {
  LogRequestMeta,
  LogResponseMeta,
  LogMetaConfig,
  LOG_REQUEST_META_KEY,
  LOG_RESPONSE_META_KEY,
} from "./log-meta.decorator";

// Control decorators
export {
  NoLog,
  LogSamplingHint,
  SamplingHintLevel,
  NO_LOG_KEY,
  LOG_SAMPLING_HINT_KEY,
} from "./log-control.decorator";

// Redaction decorator
export {
  LogRedact,
  LogRedactConfig,
  LOG_REDACT_KEY,
  DEFAULT_REDACT_PATHS,
} from "./log-redact.decorator";
