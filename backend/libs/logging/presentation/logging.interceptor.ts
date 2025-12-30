import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Observable, throwError } from "rxjs";
import { catchError, finalize } from "rxjs/operators";
import { Request } from "express";
import { randomUUID } from "crypto";
import { LoggingService } from "@logging/services/index";
import { ContextService } from "@logging/services/index";

/**
 * LoggingInterceptor - Automatically logs every HTTP request as a Wide Event.
 *
 * Responsibilities:
 * - Initialize logging context at request start (sync)
 * - Track request duration (performance)
 * - Capture errors
 * - Finalize and flush the Wide Event at request end (async)
 *
 * This ensures one Wide Event per request, even on error or early return.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly SERVICE_METADATA_KEY = "service";

  constructor(
    private readonly loggingService: LoggingService,
    private readonly contextService: ContextService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();

    const requestId =
      (request.headers["x-request-id"] as string) || randomUUID();
    request.headers["x-request-id"] = requestId;

    // Get service name from controller metadata, fallback to env var or default
    const serviceName =
      this.reflector.get<string>(
        this.SERVICE_METADATA_KEY,
        context.getHandler(),
      ) ||
      this.reflector.get<string>(
        this.SERVICE_METADATA_KEY,
        context.getClass(),
      ) ||
      process.env.SERVICE_NAME ||
      "backend";

    const loggingContext = this.loggingService.initializeContext(
      requestId,
      serviceName,
      `${request.method} ${request.route?.path || request.path}`,
    );

    const startTime = Date.now();

    return this.contextService.run(loggingContext, () => {
      return next.handle().pipe(
        catchError((error) => {
          let errorCode = "UNKNOWN";
          let errorMessage = "Unknown error";

          if (error instanceof HttpException) {
            const errorResponse = error.getResponse();
            errorCode =
              (errorResponse as any)?.errorCode ||
              (errorResponse as any)?.code ||
              error.getStatus().toString();
            errorMessage =
              typeof errorResponse === "string"
                ? errorResponse
                : (errorResponse as any)?.errorMessage ||
                  (errorResponse as any)?.message ||
                  error.message;
          } else if (error instanceof Error) {
            errorCode =
              ((error as any).code as string) ||
              ((error as any).status?.toString() as string) ||
              "UNKNOWN";
            errorMessage = error.message || "Unknown error";
          }

          loggingContext.error = {
            code: errorCode,
            message: errorMessage,
          };

          return throwError(() => error);
        }),
        finalize(() => {
          const durationMs = Date.now() - startTime;
          loggingContext.performance = { durationMs };

          this.loggingService.finalize(loggingContext).catch(() => {});
        }),
      );
    });
  }
}
