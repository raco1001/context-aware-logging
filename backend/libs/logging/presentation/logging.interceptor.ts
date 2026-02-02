import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Inject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, throwError } from 'rxjs';
import { catchError, finalize, tap } from 'rxjs/operators';
import { Request } from 'express';
import { randomUUID } from 'crypto';
import { LoggingUseCase } from '@logging/in-ports';
import { ContextService } from 'libs/logging/service';
import { FinalizeMetrics } from '@logging/domain';
import { RouteNormalizer, ErrorNormalizer } from './normalizers';

// Import decorator metadata keys
import {
  LOG_USER_KEY,
  LOG_USER_FROM_REQUEST_KEY,
  LOG_REQUEST_META_KEY,
  LOG_RESPONSE_META_KEY,
  NO_LOG_KEY,
  LOG_REDACT_KEY,
  LOG_SAMPLING_HINT_KEY,
  LogUserConfig,
  LogMetaConfig,
  LogRedactConfig,
  DEFAULT_REDACT_PATHS,
} from './decorators';

/**
 * Cached metadata for a handler to avoid repeated Reflector lookups.
 */
interface HandlerMetadata {
  noLog: boolean;
  serviceName: string | null;
  userConfig: LogUserConfig | null;
  logUserFromRequest: boolean;
  requestMetaConfig: (LogMetaConfig & { paths: string[] }) | null;
  responseMetaConfig: (LogMetaConfig & { paths: string[] }) | null;
  redactConfig: LogRedactConfig;
  samplingHint: string | null;
}

/**
 * LoggingInterceptor - Policy-based context enrichment for Wide Event logging.
 *
 * Responsibilities:
 * - Initialize logging context at request start (sync)
 * - Auto-enrich context from decorator metadata (@LogUser, @LogRequestMeta, etc.)
 * - Normalize routes for consistent querying
 * - Normalize errors for stable error codes/messages
 * - Track request duration (performance)
 * - Finalize and flush the Wide Event at request end (async)
 *
 * Performance Optimization:
 * - Caches handler metadata to avoid repeated Reflector lookups
 * - Uses WeakMap to allow garbage collection of unused handlers
 *
 * This ensures one Wide Event per request with declarative enrichment policy.
 * Business logic no longer needs to call loggingService.addUserContext() directly.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly SERVICE_METADATA_KEY = 'service';

  /**
   * Cache for handler metadata to avoid repeated Reflector lookups.
   * WeakMap allows GC of handlers when they're no longer referenced.
   */
  private readonly metadataCache = new WeakMap<Function, HandlerMetadata>();

  constructor(
    @Inject(LoggingUseCase)
    private readonly loggingUseCase: LoggingUseCase,
    private readonly contextService: ContextService,
    private readonly reflector: Reflector,
    private readonly finalizeMetrics: FinalizeMetrics,
  ) {}

  /**
   * Get or create cached metadata for a handler.
   * All Reflector lookups happen once per handler, then cached.
   */
  private getHandlerMetadata(
    handler: Function,
    controller: Function,
  ): HandlerMetadata {
    let cached = this.metadataCache.get(handler);

    if (!cached) {
      cached = {
        noLog:
          this.reflector.get<boolean>(NO_LOG_KEY, handler) ||
          this.reflector.get<boolean>(NO_LOG_KEY, controller) ||
          false,
        serviceName:
          this.reflector.get<string>(this.SERVICE_METADATA_KEY, handler) ||
          this.reflector.get<string>(this.SERVICE_METADATA_KEY, controller) ||
          null,
        userConfig:
          this.reflector.get<LogUserConfig>(LOG_USER_KEY, handler) ||
          this.reflector.get<LogUserConfig>(LOG_USER_KEY, controller) ||
          null,
        logUserFromRequest:
          this.reflector.get<boolean>(LOG_USER_FROM_REQUEST_KEY, handler) ||
          this.reflector.get<boolean>(LOG_USER_FROM_REQUEST_KEY, controller) ||
          false,
        requestMetaConfig:
          this.reflector.get<LogMetaConfig & { paths: string[] }>(
            LOG_REQUEST_META_KEY,
            handler,
          ) ||
          this.reflector.get<LogMetaConfig & { paths: string[] }>(
            LOG_REQUEST_META_KEY,
            controller,
          ) ||
          null,
        responseMetaConfig:
          this.reflector.get<LogMetaConfig & { paths: string[] }>(
            LOG_RESPONSE_META_KEY,
            handler,
          ) ||
          this.reflector.get<LogMetaConfig & { paths: string[] }>(
            LOG_RESPONSE_META_KEY,
            controller,
          ) ||
          null,
        redactConfig: this.reflector.get<LogRedactConfig>(
          LOG_REDACT_KEY,
          handler,
        ) ||
          this.reflector.get<LogRedactConfig>(LOG_REDACT_KEY, controller) || {
            paths: DEFAULT_REDACT_PATHS,
            replacement: '[REDACTED]',
          },
        samplingHint:
          this.reflector.get<string>(LOG_SAMPLING_HINT_KEY, handler) ||
          this.reflector.get<string>(LOG_SAMPLING_HINT_KEY, controller) ||
          null,
      };

      this.metadataCache.set(handler, cached);
    }

    return cached;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const handler = context.getHandler();
    const controller = context.getClass();

    // Get cached metadata (single lookup per handler, then cached)
    const metadata = this.getHandlerMetadata(handler, controller);

    // 1. Check @NoLog - skip logging entirely if decorated
    if (metadata.noLog) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Request>();

    // Generate or extract request ID
    const requestId =
      (request.headers['x-request-id'] as string) || randomUUID();
    request.headers['x-request-id'] = requestId;

    // Get service name from cached metadata, fallback to env var or default
    const serviceName =
      metadata.serviceName || process.env.SERVICE_NAME || 'backend';

    // 2. Use RouteNormalizer for consistent route identification
    const route = RouteNormalizer.normalize(request);

    // Initialize logging context
    const loggingContext = this.loggingUseCase.initializeContext(
      requestId,
      serviceName,
      route,
    );

    // 3. Process @LogUser or @LogUserFromRequest (using cached config)
    this.applyUserEnrichmentCached(request, metadata, loggingContext);

    // 4. Process @LogRequestMeta with @LogRedact (using cached config)
    this.applyRequestMetaEnrichmentCached(request, metadata, loggingContext);

    // 5. Process @LogSamplingHint (using cached config)
    if (metadata.samplingHint) {
      loggingContext._metadata = {
        ...loggingContext._metadata,
        _samplingHint: metadata.samplingHint,
      };
    }

    const startTime = Date.now();

    return this.contextService.run(loggingContext, () => {
      return next.handle().pipe(
        // 6. Process @LogResponseMeta - extract fields from response
        tap((response) => {
          if (metadata.responseMetaConfig && response) {
            const responseMeta = this.extractResponseMeta(
              response,
              metadata.responseMetaConfig,
            );
            loggingContext._metadata = {
              ...loggingContext._metadata,
              ...responseMeta,
            };
          }
        }),
        catchError((error) => {
          // 7. Use ErrorNormalizer for consistent error handling
          const normalized = ErrorNormalizer.normalize(error);

          loggingContext.error = {
            code: normalized.code,
            message: normalized.message,
          };

          // Store detailed error metadata separately
          loggingContext._metadata = {
            ...loggingContext._metadata,
            _errorMeta: normalized._errorMeta,
          };

          return throwError(() => error);
        }),
        finalize(() => {
          const durationMs = Date.now() - startTime;
          loggingContext.performance = { durationMs };

          // 8. Finalize with metrics tracking
          this.loggingUseCase
            .finalize(loggingContext)
            .then(() => this.finalizeMetrics.recordSuccess())
            .catch((err) => this.finalizeMetrics.recordFailure(err));
        }),
      );
    });
  }

  /**
   * Apply user context enrichment using cached metadata.
   */
  private applyUserEnrichmentCached(
    request: Request,
    metadata: HandlerMetadata,
    loggingContext: any,
  ): void {
    // Check @LogUserFromRequest first (simpler case)
    if (metadata.logUserFromRequest) {
      const user = (request as any).user;
      if (user && user.id) {
        loggingContext.user = {
          id: String(user.id),
          role: String(user.role || 'UNKNOWN'),
        };
      }
      return;
    }

    // Check @LogUser with path config
    if (metadata.userConfig) {
      const userId = this.extractValueByPath(request, metadata.userConfig.id);
      const userRole = this.extractValueByPath(
        request,
        metadata.userConfig.role,
      );

      if (userId) {
        loggingContext.user = {
          id: String(userId),
          role: String(userRole || 'UNKNOWN'),
        };
      }
    }
  }

  /**
   * Apply request metadata enrichment using cached metadata.
   */
  private applyRequestMetaEnrichmentCached(
    request: Request,
    metadata: HandlerMetadata,
    loggingContext: any,
  ): void {
    const metaConfig = metadata.requestMetaConfig;
    if (!metaConfig || !metaConfig.paths) {
      return;
    }

    const redactConfig = metadata.redactConfig;
    const extractedMeta: Record<string, any> = {};

    for (const path of metaConfig.paths) {
      const value = this.extractValueByPath(request, path);
      if (value !== undefined) {
        // Check if this path should be redacted
        const shouldRedact = redactConfig.paths.some(
          (redactPath) =>
            path === redactPath ||
            path.endsWith(`.${redactPath.split('.').pop()}`),
        );

        const key = path.split('.').pop() || path;
        extractedMeta[key] = shouldRedact
          ? redactConfig.replacement
          : this.sanitizeValue(
              value,
              metaConfig.maxDepth ?? 2,
              metaConfig.maxStringLength ?? 200,
            );
      }
    }

    loggingContext._metadata = {
      ...loggingContext._metadata,
      ...extractedMeta,
    };
  }

  /**
   * Extract response metadata from @LogResponseMeta configuration.
   */
  private extractResponseMeta(
    response: any,
    config: LogMetaConfig & { paths: string[] },
  ): Record<string, any> {
    const meta: Record<string, any> = {};

    for (const path of config.paths) {
      const value = this.getNestedValue(response, path);
      if (value !== undefined) {
        const key = path.includes('.') ? path.replace(/\./g, '_') : path;
        meta[`response_${key}`] = this.sanitizeValue(
          value,
          config.maxDepth ?? 2,
          config.maxStringLength ?? 200,
        );
      }
    }

    return meta;
  }

  /**
   * Extract value from request using dot-notation path.
   * Supports: body.field, params.field, query.field, headers.field
   */
  private extractValueByPath(request: Request, path: string): any {
    const parts = path.split('.');
    const source = parts[0];
    const fieldPath = parts.slice(1).join('.');

    let sourceObj: any;
    switch (source) {
      case 'body':
        sourceObj = request.body;
        break;
      case 'params':
        sourceObj = request.params;
        break;
      case 'query':
        sourceObj = request.query;
        break;
      case 'headers':
        sourceObj = request.headers;
        break;
      default:
        return undefined;
    }

    if (!sourceObj) {
      return undefined;
    }

    return this.getNestedValue(sourceObj, fieldPath);
  }

  /**
   * Get nested value from object using dot-notation path.
   */
  private getNestedValue(obj: any, path: string): any {
    if (!path) {
      return obj;
    }

    const parts = path.split('.');
    let current = obj;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }
      current = current[part];
    }

    return current;
  }

  /**
   * Sanitize value for safe logging.
   * - Limits depth for nested objects
   * - Truncates long strings
   * - Handles circular references
   */
  private sanitizeValue(
    value: any,
    maxDepth: number,
    maxStringLength: number,
    currentDepth = 0,
  ): any {
    if (value === null || value === undefined) {
      return value;
    }

    if (typeof value === 'string') {
      return value.length > maxStringLength
        ? value.slice(0, maxStringLength) + '...'
        : value;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }

    if (currentDepth >= maxDepth) {
      if (Array.isArray(value)) {
        return `[Array(${value.length})]`;
      }
      if (typeof value === 'object') {
        return '[Object]';
      }
      return String(value);
    }

    if (Array.isArray(value)) {
      return value
        .slice(0, 10)
        .map((item) =>
          this.sanitizeValue(item, maxDepth, maxStringLength, currentDepth + 1),
        );
    }

    if (typeof value === 'object') {
      const sanitized: Record<string, any> = {};
      const keys = Object.keys(value).slice(0, 20);
      for (const key of keys) {
        sanitized[key] = this.sanitizeValue(
          value[key],
          maxDepth,
          maxStringLength,
          currentDepth + 1,
        );
      }
      return sanitized;
    }

    return String(value);
  }
}
