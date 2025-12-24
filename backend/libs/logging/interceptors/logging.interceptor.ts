import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpException,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';
import { Request } from 'express';
import { randomUUID } from 'crypto';
import { LoggingService } from '../services/logging.service';
import { ContextService } from '../services/context.service';

/**
 * LoggingInterceptor - Automatically logs every HTTP request as a Wide Event.
 *
 * Responsibilities:
 * - Initialize logging context at request start
 * - Track request duration (performance)
 * - Capture errors
 * - Finalize and flush the Wide Event at request end
 *
 * This ensures one Wide Event per request, even on error or early return.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(
    private readonly loggingService: LoggingService,
    private readonly contextService: ContextService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();

    // Generate request ID if not present
    const requestId =
      (request.headers['x-request-id'] as string) || randomUUID();
    request.headers['x-request-id'] = requestId;

    // Initialize logging context
    const loggingContext = this.loggingService.initializeContext(
      requestId,
      process.env.SERVICE_NAME || 'backend',
      `${request.method} ${request.route?.path || request.path}`,
    );

    // Track start time for performance metrics
    const startTime = Date.now();

    // Run the request handler within the logging context
    return this.contextService.run(loggingContext, () => {
      return next.handle().pipe(
        catchError((error) => {
          // Error path: add error context for logging
          let errorCode = 'UNKNOWN';
          let errorMessage = 'Unknown error';

          if (error instanceof HttpException) {
            const errorResponse = error.getResponse();
            errorCode =
              (errorResponse as any)?.errorCode ||
              (errorResponse as any)?.code ||
              error.getStatus().toString();
            errorMessage =
              typeof errorResponse === 'string'
                ? errorResponse
                : (errorResponse as any)?.errorMessage ||
                  (errorResponse as any)?.message ||
                  error.message;
          } else if (error instanceof Error) {
            errorCode =
              ((error as any).code as string) ||
              ((error as any).status?.toString() as string) ||
              'UNKNOWN';
            errorMessage = error.message || 'Unknown error';
          }

          // Use the captured context directly as fallback
          loggingContext.error = {
            code: errorCode,
            message: errorMessage,
          };

          return throwError(() => error);
        }),
        finalize(() => {
          // Always finalize: calculate duration and flush the Wide Event
          const durationMs = Date.now() - startTime;
          loggingContext.performance = { durationMs };

          // Pass the captured context explicitly to ensure it's not lost in async boundaries
          this.loggingService.finalize(loggingContext).catch(() => {
            // Silently ignore logging errors
          });
        }),
      );
    });
  }
}
