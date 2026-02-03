import { SetMetadata } from '@nestjs/common';

/**
 * Metadata keys for logging control decorators
 */
export const NO_LOG_KEY = 'no_log';
export const LOG_SAMPLING_HINT_KEY = 'log_sampling_hint';

/**
 * Sampling hint values
 */
export type SamplingHintLevel = 'critical' | 'important' | 'normal' | 'low';

/**
 * @NoLog - Excludes the endpoint from logging entirely.
 *
 * Use for health checks, metrics endpoints, or high-frequency
 * endpoints that would generate excessive logs without value.
 *
 * @example
 * ```typescript
 * @Get('health')
 * @NoLog()
 * healthCheck() {
 *   return { status: 'ok' };
 * }
 * ```
 *
 * @example Applied at controller level
 * ```typescript
 * @Controller('metrics')
 * @NoLog()
 * export class MetricsController { ... }
 * ```
 */
export const NoLog = () => SetMetadata(NO_LOG_KEY, true);

/**
 * @LogSamplingHint - Provides a hint to the sampling policy.
 *
 * This doesn't guarantee recording; the actual decision is made by SamplingPolicy.
 * However, 'critical' routes are typically always recorded.
 *
 * @param level - Importance level for sampling decisions
 *   - 'critical': Always record (payment, auth, critical business flows)
 *   - 'important': Higher sampling rate
 *   - 'normal': Default sampling rate (default behavior)
 *   - 'low': Lower sampling rate (listing, search, etc.)
 *
 * @example
 * ```typescript
 * @Post('payment')
 * @LogSamplingHint('critical')
 * async processPayment(@Body() dto: PaymentDto) { ... }
 * ```
 *
 * @example
 * ```typescript
 * @Get('search')
 * @LogSamplingHint('low')
 * async search(@Query() query: SearchQuery) { ... }
 * ```
 */
export const LogSamplingHint = (level: SamplingHintLevel) =>
  SetMetadata(LOG_SAMPLING_HINT_KEY, level);
