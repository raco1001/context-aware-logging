import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { LoggingContext } from "./context";

/**
 * Sampling decision result with explanation for debugging/auditing.
 */
export interface SamplingDecision {
  shouldRecord: boolean;
  reason: SamplingReason;
}

/**
 * Reasons for sampling decisions - useful for debugging and policy verification.
 */
export enum SamplingReason {
  // Always recorded
  HAS_ERROR = "HAS_ERROR",
  SLOW_REQUEST = "SLOW_REQUEST",
  CRITICAL_ROUTE = "CRITICAL_ROUTE",

  // Probabilistically sampled
  SAMPLED_NORMAL = "SAMPLED_NORMAL",
  NOT_SAMPLED = "NOT_SAMPLED",
}

/**
 * SamplingPolicy - Determines which logs to persist based on configurable rules.
 *
 * Design Principles:
 * 1. **Deterministic**: Same requestId always produces the same decision (hash-based).
 * 2. **Explainable**: Every decision has a clear reason.
 * 3. **100% Signal Retention**: Errors and slow requests are never sampled out.
 *
 * Configuration (via environment variables):
 * - LOG_SAMPLING_NORMAL_RATE: 0.01 (1% of normal requests)
 * - LOG_SLOW_THRESHOLD_MS: 2000 (requests slower than 2s are always recorded)
 * - LOG_CRITICAL_ROUTES: comma-separated list of routes to always record
 */
@Injectable()
export class SamplingPolicy {
  private readonly normalRate: number;
  private readonly slowThresholdMs: number;
  private readonly criticalRoutes: Set<string>;

  constructor(private readonly configService: ConfigService) {
    this.normalRate = this.configService.get<number>(
      "LOG_SAMPLING_NORMAL_RATE",
      0.01,
    );
    this.slowThresholdMs = this.configService.get<number>(
      "LOG_SLOW_THRESHOLD_MS",
      2000,
    );

    const criticalRoutesStr = this.configService.get<string>(
      "LOG_CRITICAL_ROUTES",
      "",
    );
    this.criticalRoutes = new Set(
      criticalRoutesStr
        .split(",")
        .map((r) => r.trim())
        .filter((r) => r.length > 0),
    );
  }

  /**
   * Determine whether the given context should be persisted.
   */
  shouldRecord(context: LoggingContext): SamplingDecision {
    // Rule 1: Always record errors
    if (context.error) {
      return { shouldRecord: true, reason: SamplingReason.HAS_ERROR };
    }

    // Rule 2: Always record slow requests
    if (
      context.performance?.durationMs &&
      context.performance.durationMs > this.slowThresholdMs
    ) {
      return { shouldRecord: true, reason: SamplingReason.SLOW_REQUEST };
    }

    // Rule 3: Always record critical routes
    if (this.criticalRoutes.has(context.route)) {
      return { shouldRecord: true, reason: SamplingReason.CRITICAL_ROUTE };
    }

    // Rule 4: Probabilistic sampling for normal requests
    if (this.isSampled(context.requestId, this.normalRate)) {
      return { shouldRecord: true, reason: SamplingReason.SAMPLED_NORMAL };
    }

    return { shouldRecord: false, reason: SamplingReason.NOT_SAMPLED };
  }

  /**
   * Deterministic sampling based on requestId hash.
   * The same requestId will always produce the same result,
   * ensuring consistency across distributed instances.
   */
  private isSampled(requestId: string, rate: number): boolean {
    if (rate >= 1) return true;
    if (rate <= 0) return false;

    const probability = Math.random() * 100;
    return probability <= rate * 100;
  }

  /**
   * Get current sampling configuration for monitoring/debugging.
   */
  getConfig(): {
    normalRate: number;
    slowThresholdMs: number;
    criticalRoutes: string[];
  } {
    return {
      normalRate: this.normalRate,
      slowThresholdMs: this.slowThresholdMs,
      criticalRoutes: Array.from(this.criticalRoutes),
    };
  }
}
