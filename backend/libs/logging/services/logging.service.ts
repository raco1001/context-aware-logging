import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { LoggerPort } from "@logging/out-ports/index";
import { WideEvent, LoggingContext, Latency } from "@logging/domain/index";
import { ContextService } from "./context.service";
import { LatencyBucket } from "@logging/value-objects/index";

/**
 * LoggingService - Application layer service for managing Wide Events.
 * Responsible for constructing Wide Events from context and delegating to Logger.
 */
@Injectable()
export class LoggingService implements OnModuleDestroy {
  constructor(
    private readonly contextService: ContextService,
    private readonly logger: LoggerPort,
  ) {}

  /**
   * Initialize logging context for a new request.
   * Should be called at the start of each HTTP request.
   */
  initializeContext(
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
  addUserContext(user: { id: string; role: string }): void {
    this.contextService.addUserContext(user);
  }

  /**
   * Add error context to the current request.
   */
  addError(error: { code: string; message: string }): void {
    this.contextService.addError(error);
  }

  /**
   * Add performance metrics to the current request.
   */
  addPerformance(performance: { durationMs: number }): void {
    this.contextService.addPerformance(performance);
  }

  /**
   * Add domain-specific metadata to the current request.
   */
  addMetadata(metadata: Record<string, any>): void {
    const currentContext = this.contextService.getContext();
    const existingMetadata = currentContext?._metadata || {};
    this.contextService.updateContext({
      _metadata: { ...existingMetadata, ...metadata },
    });
  }

  private finalizedRequestIds = new Set<string>();

  /**
   * Finalize and flush the current request's Wide Event.
   * This should be called once per request, even on error or early return.
   */
  async finalize(explicitContext?: LoggingContext): Promise<void> {
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

    // We pass the core event plus internal processing fields to the logger.
    // This preserves the WideEvent domain model while allowing infrastructure
    // to store semantic enrichment data.
    await this.logger.log(event, context._metadata, _summary);
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
  onModuleDestroy(): void {
    // Any cleanup needed
  }
}
