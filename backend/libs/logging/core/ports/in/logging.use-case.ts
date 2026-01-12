import { LoggingContext } from "@logging/domain";

/**
 * LoggingUseCase - Inbound port (use case) for logging operations.
 *
 * This abstract class defines the contract for logging functionality,
 * following the Hexagonal Architecture pattern.
 *
 * Responsibilities:
 * - Context management (initialize, add user/error/performance/metadata)
 * - Wide Event finalization and persistence
 * - Service boundary tracking
 *
 * This port allows the application layer to depend on an abstraction,
 * making it easier to test and swap implementations.
 */
export abstract class LoggingUseCase {
  /**
   * Initialize logging context for a new request.
   * Should be called at the start of each HTTP request.
   *
   * @param requestId Unique identifier for the request
   * @param service Service name handling the request
   * @param route Route path of the request
   * @returns Initialized LoggingContext
   */
  abstract initializeContext(
    requestId: string,
    service: string,
    route: string,
  ): LoggingContext;

  /**
   * Add user context to the current request.
   *
   * @param user User information (id and role)
   */
  abstract addUserContext(user: { id: string; role: string }): void;

  /**
   * Add error context to the current request.
   *
   * @param error Error information (code and message)
   */
  abstract addError(error: { code: string; message: string }): void;

  /**
   * Add performance metrics to the current request.
   *
   * @param performance Performance metrics (durationMs)
   */
  abstract addPerformance(performance: { durationMs: number }): void;

  /**
   * Add domain-specific metadata to the current request.
   *
   * @param metadata Key-value pairs of metadata
   */
  abstract addMetadata(metadata: Record<string, any>): void;

  /**
   * Dynamically update the service field.
   * Use this when processing moves to a different logical service boundary
   * or when an error occurs in a downstream service.
   *
   * @param service New service name
   */
  abstract setService(service: string): void;

  /**
   * Finalize and flush the current request's Wide Event.
   * This should be called once per request, even on error or early return.
   *
   * Phase 5: Applies sampling policy before persisting.
   * - Errors and slow requests are always recorded (100% retention).
   * - Normal requests are sampled based on configured rate.
   *
   * @param explicitContext Optional explicit context to finalize.
   *                        If not provided, uses the current context from ContextService.
   */
  abstract finalize(explicitContext?: LoggingContext): Promise<void>;
}
