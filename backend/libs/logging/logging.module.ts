import { Module, Global } from '@nestjs/common';
import { LoggingService } from './services/logging.service';
import { ContextService } from './services/context.service';
import { FileLogger } from './infrastructure/file/file.logger';
import { Logger } from './core/domain/logger.interface';

/**
 * LoggingModule - NestJS module for the logging library.
 *
 * This module is marked as @Global() so it can be imported once in AppModule
 * and used throughout the application without re-importing.
 *
 * The Logger interface is provided via a token, allowing easy replacement
 * of the implementation (e.g., FileLogger -> MongoLogger in Phase 2).
 */
@Global()
@Module({
  providers: [
    ContextService,
    LoggingService,
    {
      provide: 'LOGGER',
      useClass: FileLogger,
    },
    // Also provide FileLogger directly for cases where it's needed
    FileLogger,
  ],
  exports: [LoggingService, ContextService],
})
export class LoggingModule {}
