/**
 * Public API exports for the logging library.
 * This allows clean imports: import { LoggingModule, LoggingService } from '@libs/logging'
 */

// Module
export { LoggingModule } from "./logging.module";

// Services
export { LoggingService } from "./service/logging.service";
export { LoggingUseCase } from "./core/ports/in/logging.use-case";
export { ContextService } from "./service/context.service";

// Interceptors
export { LoggingInterceptor } from "./presentation/logging.interceptor";

// Decorators
export {
  LogUser,
  LogUserFromRequest,
  LogRequestMeta,
  LogResponseMeta,
  NoLog,
  LogSamplingHint,
  LogRedact,
  Service,
} from "./presentation";

// Domain utilities
export { FinalizeMetrics } from "./core/domain/finalize.metrics";
export { RouteNormalizer } from "./core/domain/route.normalizer";
export { ErrorNormalizer } from "./core/domain/error.normalizer";
