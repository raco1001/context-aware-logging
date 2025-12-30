import { Module, Global } from "@nestjs/common";
import { LoggingService, ContextService } from "@logging/services/index";
import {
  MongoLogger,
  MongoConnectionClient,
} from "@logging/infrastructure/index";
import { LoggerPort } from "@logging/out-ports/index";
import { LoggingInterceptor } from "@logging/presentation/index";

/**
 * LoggingModule - NestJS module for the logging library.
 *
 * This module is marked as @Global() so it can be imported once in AppModule
 * and used throughout the application without re-importing.
 *
 */
@Global()
@Module({
  providers: [
    MongoConnectionClient,
    {
      provide: LoggerPort,
      useClass: MongoLogger,
    },
    ContextService,
    LoggingService,
    LoggingInterceptor,
  ],
  exports: [LoggingService, ContextService, LoggingInterceptor],
})
export class LoggingModule {}
