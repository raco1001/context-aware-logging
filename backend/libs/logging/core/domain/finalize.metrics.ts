import { Injectable, Logger } from '@nestjs/common';

/**
 * Statistics for finalize operations.
 */
export interface FinalizeStats {
  /** Total successful finalize calls */
  successCount: number;
  /** Total failed finalize calls */
  failureCount: number;
  /** Last error message (if any) */
  lastError: string | null;
  /** Timestamp of last error */
  lastErrorTime: string | null;
  /** Success rate percentage */
  successRate: number;
}

/**
 * FinalizeMetrics - Collects metrics for finalize operations.
 *
 * Problem:
 * - Current implementation: `.catch(() => {})` silently swallows errors
 * - No visibility into finalize failures
 * - Cannot monitor logging system health
 *
 * Solution:
 * - Track success/failure counts
 * - Log failures to stderr (fallback observability)
 * - Expose metrics for monitoring endpoints
 *
 * @example Usage in LoggingInterceptor
 * ```typescript
 * finalize(() => {
 *   this.loggingUseCase.finalize(context)
 *     .then(() => this.finalizeMetrics.recordSuccess())
 *     .catch((err) => this.finalizeMetrics.recordFailure(err));
 * })
 * ```
 */
@Injectable()
export class FinalizeMetrics {
  private readonly logger = new Logger(FinalizeMetrics.name);

  private successCount = 0;
  private failureCount = 0;
  private lastError: Error | null = null;
  private lastErrorTime: Date | null = null;

  /** Threshold for warning about high failure rate */
  private readonly FAILURE_RATE_WARNING_THRESHOLD = 0.05; // 5%
  /** Interval for rate-limited warning logs (ms) */
  private readonly WARNING_INTERVAL_MS = 60000; // 1 minute
  private lastWarningTime = 0;

  /**
   * Record a successful finalize operation.
   */
  recordSuccess(): void {
    this.successCount++;
  }

  /**
   * Record a failed finalize operation.
   * Logs to stderr for minimal observability even when logging system fails.
   */
  recordFailure(error: Error): void {
    this.failureCount++;
    this.lastError = error;
    this.lastErrorTime = new Date();

    // Always log to stderr for observability
    // Using console.error ensures output even if NestJS logger is affected
    console.error(
      `[FinalizeMetrics] Finalize failed: ${error.message}`,
      error.stack ? `\n${error.stack.split('\n').slice(0, 3).join('\n')}` : '',
    );

    // Rate-limited warning for high failure rate
    this.checkFailureRate();
  }

  /**
   * Check failure rate and emit warning if above threshold.
   */
  private checkFailureRate(): void {
    const total = this.successCount + this.failureCount;
    if (total < 100) {
      // Not enough data to calculate meaningful rate
      return;
    }

    const failureRate = this.failureCount / total;
    const now = Date.now();

    if (
      failureRate > this.FAILURE_RATE_WARNING_THRESHOLD &&
      now - this.lastWarningTime > this.WARNING_INTERVAL_MS
    ) {
      this.lastWarningTime = now;
      this.logger.warn(
        `High finalize failure rate detected: ${(failureRate * 100).toFixed(2)}% ` +
          `(${this.failureCount}/${total} failures). ` +
          `Last error: ${this.lastError?.message}`,
      );
    }
  }

  /**
   * Get current statistics.
   * Useful for health check endpoints or monitoring.
   */
  getStats(): FinalizeStats {
    const total = this.successCount + this.failureCount;
    const successRate = total > 0 ? (this.successCount / total) * 100 : 100;

    return {
      successCount: this.successCount,
      failureCount: this.failureCount,
      lastError: this.lastError?.message ?? null,
      lastErrorTime: this.lastErrorTime?.toISOString() ?? null,
      successRate: Math.round(successRate * 100) / 100,
    };
  }

  /**
   * Reset statistics.
   * Useful for testing or periodic reset.
   */
  reset(): void {
    this.successCount = 0;
    this.failureCount = 0;
    this.lastError = null;
    this.lastErrorTime = null;
    this.lastWarningTime = 0;
  }

  /**
   * Check if the logging system is healthy.
   * Returns false if failure rate exceeds threshold.
   */
  isHealthy(): boolean {
    const total = this.successCount + this.failureCount;
    if (total < 10) {
      // Not enough data, assume healthy
      return true;
    }

    const failureRate = this.failureCount / total;
    return failureRate <= this.FAILURE_RATE_WARNING_THRESHOLD;
  }
}
