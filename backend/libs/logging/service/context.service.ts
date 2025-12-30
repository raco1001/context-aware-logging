import { Injectable } from "@nestjs/common";
import { AsyncLocalStorage } from "async_hooks";
import { LoggingContext } from "@logging/domain";

/**
 * ContextService - Manages request-scoped logging context using AsyncLocalStorage.
 * This ensures context is preserved across async boundaries.
 */
@Injectable()
export class ContextService {
  private readonly asyncLocalStorage = new AsyncLocalStorage<LoggingContext>();

  /**
   * Run a function within a logging context.
   * This should be called at the start of each request.
   */
  run<T>(context: LoggingContext, fn: () => T): T {
    return this.asyncLocalStorage.run(context, fn);
  }

  /**
   * Get the current logging context.
   * Returns undefined if called outside of a context.
   */
  getContext(): LoggingContext | undefined {
    return this.asyncLocalStorage.getStore();
  }

  /**
   * Update the current context by merging new values.
   */
  updateContext(updates: Partial<LoggingContext>): void {
    const context = this.getContext();
    if (context) {
      Object.assign(context, updates);
    }
  }

  /**
   * Add user context to the current logging context.
   */
  addUserContext(user: { id: string; role: string }): void {
    this.updateContext({ user });
  }

  /**
   * Add error context to the current logging context.
   */
  addError(error: { code: string; message: string }): void {
    this.updateContext({ error });
  }

  /**
   * Add performance context to the current logging context.
   */
  addPerformance(performance: { durationMs: number }): void {
    this.updateContext({ performance });
  }
}
