import { LoggingContext } from './context';

/**
 * SamplingDecision - Result of sampling decision with explanation.
 */
export interface SamplingDecision {
  shouldRecord: boolean;
  reason: SamplingReason;
}

/**
 * SamplingReason - Reasons for sampling decisions.
 */
export enum SamplingReason {
  /**
   * Always recorded.
   */
  HAS_ERROR = 'HAS_ERROR',
  SLOW_REQUEST = 'SLOW_REQUEST',
  CRITICAL_ROUTE = 'CRITICAL_ROUTE',

  /**
   * Probabilistically sampled.
   */
  SAMPLED_NORMAL = 'SAMPLED_NORMAL',
  NOT_SAMPLED = 'NOT_SAMPLED',
}

/**
 * SamplingPolicyConfig - Configuration for SamplingPolicy.
 * Extracted to allow dependency injection without framework coupling.
 */
export interface SamplingPolicyConfig {
  /** Sampling rate for normal requests (0.0 to 1.0). Default: 0.01 (1%) */
  normalRate: number;
  /** Threshold in ms above which requests are always recorded. Default: 2000 */
  slowThresholdMs: number;
  /** Routes that are always recorded regardless of sampling. */
  criticalRoutes: string[];
}

/**
 * Default configuration values for SamplingPolicy.
 */
export const DEFAULT_SAMPLING_CONFIG: SamplingPolicyConfig = {
  normalRate: 0.01,
  slowThresholdMs: 2000,
  criticalRoutes: [],
};

/**
 * SamplingPolicy - Pure domain object that determines which logs to persist.
 *
 * This class has no framework dependencies. Configuration is injected via constructor,
 * allowing the infrastructure layer to handle config loading.
 */
export class SamplingPolicy {
  private readonly normalRate: number;
  private readonly slowThresholdMs: number;
  private readonly criticalRoutes: Set<string>;

  constructor(config: Partial<SamplingPolicyConfig> = {}) {
    const mergedConfig = { ...DEFAULT_SAMPLING_CONFIG, ...config };
    this.normalRate = mergedConfig.normalRate;
    this.slowThresholdMs = mergedConfig.slowThresholdMs;
    this.criticalRoutes = new Set(mergedConfig.criticalRoutes);
  }

  /**
   * Factory method to create SamplingPolicy from environment variables.
   * Use this in module configuration.
   */
  static fromEnv(env: Record<string, string | undefined>): SamplingPolicy {
    const normalRate =
      parseFloat(env.LOG_SAMPLING_NORMAL_RATE ?? '') ||
      DEFAULT_SAMPLING_CONFIG.normalRate;
    const slowThresholdMs =
      parseInt(env.LOG_SLOW_THRESHOLD_MS ?? '', 10) ||
      DEFAULT_SAMPLING_CONFIG.slowThresholdMs;
    const criticalRoutesStr = env.LOG_CRITICAL_ROUTES ?? '';
    const criticalRoutes = criticalRoutesStr
      .split(',')
      .map((r) => r.trim())
      .filter((r) => r.length > 0);

    return new SamplingPolicy({ normalRate, slowThresholdMs, criticalRoutes });
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
    if (this.isSampled(this.normalRate)) {
      return { shouldRecord: true, reason: SamplingReason.SAMPLED_NORMAL };
    }

    return { shouldRecord: false, reason: SamplingReason.NOT_SAMPLED };
  }

  /**
   * Probabilistic sampling based on configured rate.
   */
  private isSampled(rate: number): boolean {
    if (rate >= 1) return true;
    if (rate <= 0) return false;

    const probability = Math.random() * 100;
    return probability <= rate * 100;
  }

  /**
   * Get current sampling configuration for monitoring/debugging.
   */
  getConfig(): SamplingPolicyConfig {
    return {
      normalRate: this.normalRate,
      slowThresholdMs: this.slowThresholdMs,
      criticalRoutes: Array.from(this.criticalRoutes),
    };
  }
}
