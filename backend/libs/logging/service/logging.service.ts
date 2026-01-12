import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { LoggerPort } from "@logging/out-ports";
import {
  WideEvent,
  LoggingContext,
  Latency,
  SamplingPolicy,
  SamplingReason,
} from "@logging/domain";
import { LoggingUseCase } from "@logging/in-ports";
import { ContextService } from "./context.service";
import { LatencyBucket } from "@logging/value-objects";

/**
 * LoggingService - Application layer service for managing Wide Events.
 * Responsible for constructing Wide Events from context and delegating to Logger.
 *
 * Implements LoggingUseCase to follow Hexagonal Architecture pattern.
 */
@Injectable()
export class LoggingService extends LoggingUseCase implements OnModuleDestroy {
  private readonly serviceLogger = new Logger(LoggingService.name);

  constructor(
    private readonly contextService: ContextService,
    private readonly logger: LoggerPort,
    private readonly samplingPolicy: SamplingPolicy,
  ) {
    super();
  }

  /**
   * Initialize logging context for a new request.
   * Should be called at the start of each HTTP request.
   */
  override initializeContext(
    requestId: string,
    service: string,
    route: string,
  ): LoggingContext {
    const context: LoggingContext = {
      requestId,
      timestamp: new Date().toISOString(),
      service,
      route,
      _metadata: {},
    };
    return context;
  }

  /**
   * Add user context to the current request.
   */
  override addUserContext(user: { id: string; role: string }): void {
    this.contextService.addUserContext(user);
  }

  /**
   * Add error context to the current request.
   */
  override addError(error: { code: string; message: string }): void {
    this.contextService.addError(error);
  }

  /**
   * Add performance metrics to the current request.
   */
  override addPerformance(performance: { durationMs: number }): void {
    this.contextService.addPerformance(performance);
  }

  /**
   * Add domain-specific metadata to the current request.
   */
  override addMetadata(metadata: Record<string, any>): void {
    const currentContext = this.contextService.getContext();
    const existingMetadata = currentContext?._metadata || {};
    this.contextService.updateContext({
      _metadata: { ...existingMetadata, ...metadata },
    });
  }

  /**
   * Dynamically update the service field.
   * Use this when processing moves to a different logical service boundary
   * or when an error occurs in a downstream service.
   *
   * @example
   * // In payments flow: payments -> paymentGateway -> orders
   * loggingService.setService('paymentGateway');
   * const result = await callExternalGateway();
   * if (!result.success) {
   *   loggingService.addError({ code: 'GATEWAY_TIMEOUT', message: '...' });
   *   // Error will be logged under 'paymentGateway' service
   * }
   */
  override setService(service: string): void {
    this.contextService.setService(service);
  }

  private finalizedRequestIds = new Set<string>();

  /**
   * Finalize and flush the current request's Wide Event.
   * This should be called once per request, even on error or early return.
   *
   * Phase 5: Applies sampling policy before persisting.
   * - Errors and slow requests are always recorded (100% retention).
   * - Normal requests are sampled based on configured rate.
   */
  override async finalize(explicitContext?: LoggingContext): Promise<void> {
    const context = explicitContext || this.contextService.getContext();
    if (!context) {
      // No context available, skip logging
      return;
    }

    // Prevent duplicate finalization for the same request
    if (this.finalizedRequestIds.has(context.requestId)) {
      return;
    }
    this.finalizedRequestIds.add(context.requestId);

    // Clean up old request IDs to prevent memory leak
    if (this.finalizedRequestIds.size > 1000) {
      const idsToRemove = Array.from(this.finalizedRequestIds).slice(0, 100);
      idsToRemove.forEach((id) => this.finalizedRequestIds.delete(id));
    }

    // Phase 5: Apply sampling policy
    const samplingDecision = this.samplingPolicy.shouldRecord(context);

    if (!samplingDecision.shouldRecord) {
      // Log sampling decision for monitoring (debug level in production)
      this.serviceLogger.debug(
        `Request ${context.requestId} not sampled: ${samplingDecision.reason}`,
      );
      return;
    }

    // Create a validated WideEvent instance
    const event = new WideEvent({
      requestId: context.requestId,
      timestamp: context.timestamp,
      service: context.service,
      route: context.route,
      user: context.user as any,
      error: context.error as any,
      performance: context.performance,
    });

    // Phase 3: Generate deterministic summary and embedding status
    const _summary = this.generateSummary(context);

    // Add sampling reason to metadata for auditing/debugging
    const enrichedMetadata = {
      ...context._metadata,
      _sampling: {
        recorded: true,
        reason: samplingDecision.reason,
      },
    };

    // We pass the core event plus internal processing fields to the logger.
    // This preserves the WideEvent domain model while allowing infrastructure
    // to store semantic enrichment data.
    await this.logger.log(event, enrichedMetadata, _summary);
  }

  /**
   * Phase 3: Deterministic Semantic Serialization
   * Generates a stable text representation of the event for vector embeddings.
   */
  private generateSummary(context: LoggingContext): string {
    const { service, route, error, user, performance } = context;

    const errorCode = error?.code ?? "NONE";
    const errorMessage = error?.message ?? "NONE";
    const userRole = user?.role ?? "ANONYMOUS";
    const latencyBucket = Latency.getBucket(performance?.durationMs);
    const outcome = error
      ? "FAILED"
      : latencyBucket === LatencyBucket.P_OVER_1000MS
        ? "WARNING"
        : latencyBucket === LatencyBucket.P_UNKNOWN
          ? "EDGE_CASE"
          : "SUCCESS";

    return `Outcome: ${outcome}, Service: ${service}, Route: ${route}, Error: ${errorCode}, ErrorMessage: ${errorMessage}, UserRole: ${userRole}, LatencyBucket: ${latencyBucket}`;
  }

  /**
   * Cleanup on module destroy.
   */
  onModuleDestroy(): void {}
}
