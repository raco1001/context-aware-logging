/**
 * Public API exports for the logging library.
 * This allows clean imports: import { LoggingModule, LoggingService } from '@libs/logging'
 */

// Module
export { LoggingModule } from './logging.module';

// Services
export { LoggingService } from './services/logging.service';
export { ContextService } from './services/context.service';

// Domain interfaces
export { WideEvent } from './core/domain/wide-event';
export { Logger } from './core/domain/logger.interface';
export { LoggingContext } from './core/domain/context.interface';

// Infrastructure (for testing or advanced use cases)
export { FileLogger } from './infrastructure/file/file.logger';

// Interceptors
export { LoggingInterceptor } from './interceptors/logging.interceptor';
