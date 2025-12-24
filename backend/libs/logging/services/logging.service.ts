import { Injectable, Inject, OnModuleDestroy } from '@nestjs/common';
import { Logger } from '../core/domain/logger.interface';
import { WideEvent } from '../core/domain/wide-event';
import { LoggingContext } from '../core/domain/context.interface';
import { ContextService } from './context.service';

/**
 * LoggingService - Application layer service for managing Wide Events.
 * Responsible for constructing Wide Events from context and delegating to Logger.
 */
@Injectable()
export class LoggingService implements OnModuleDestroy {
  constructor(
    private readonly contextService: ContextService,
    @Inject('LOGGER') private readonly logger: Logger,
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
    const existingMetadata = currentContext?.metadata || {};
    this.contextService.updateContext({
      metadata: { ...existingMetadata, ...metadata },
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
    // Keep only recent 1000 request IDs
    if (this.finalizedRequestIds.size > 1000) {
      const idsToRemove = Array.from(this.finalizedRequestIds).slice(0, 100);
      idsToRemove.forEach((id) => this.finalizedRequestIds.delete(id));
    }

    const event: WideEvent = {
      requestId: context.requestId,
      timestamp: context.timestamp,
      service: context.service,
      route: context.route,
      user: context.user,
      error: context.error,
      performance: context.performance,
      metadata: context.metadata,
    };

    await this.logger.log(event);
  }

  /**
   * Cleanup on module destroy.
   */
  onModuleDestroy(): void {
    // Any cleanup needed
  }
}
