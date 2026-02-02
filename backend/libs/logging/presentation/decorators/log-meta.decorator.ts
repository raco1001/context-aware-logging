import { SetMetadata } from '@nestjs/common';

/**
 * Metadata keys for request/response meta logging decorators
 */
export const LOG_REQUEST_META_KEY = 'log_request_meta';
export const LOG_RESPONSE_META_KEY = 'log_response_meta';

/**
 * Configuration for meta extraction
 */
export interface LogMetaConfig {
  /** Paths to extract (e.g., ['body.product', 'params.id']) */
  paths: string[];
  /** Maximum depth for nested object extraction (default: 2) */
  maxDepth?: number;
  /** Maximum string length before truncation (default: 200) */
  maxStringLength?: number;
}

/**
 * @LogRequestMeta - Extracts specified fields from request for logging.
 *
 * IMPORTANT: Only use allowlist-based extraction. Never log entire request.
 * Sensitive fields should be explicitly redacted using @LogRedact.
 *
 * @param paths - Array of dot-notation paths to extract from request
 *                Supports: body.*, params.*, query.*, headers.*
 *
 * @example
 * ```typescript
 * @Post()
 * @LogRequestMeta(['body.product', 'body.amount', 'params.orderId'])
 * async processOrder(@Body() dto: OrderDto) { ... }
 * ```
 *
 * @example With config object for depth/length limits
 * ```typescript
 * @Post()
 * @LogRequestMeta({ paths: ['body.items'], maxDepth: 1, maxStringLength: 100 })
 * async bulkCreate(@Body() dto: BulkDto) { ... }
 * ```
 */
export function LogRequestMeta(pathsOrConfig: string[] | LogMetaConfig) {
  const config: LogMetaConfig = Array.isArray(pathsOrConfig)
    ? { paths: pathsOrConfig }
    : pathsOrConfig;

  return SetMetadata(LOG_REQUEST_META_KEY, {
    paths: config.paths,
    maxDepth: config.maxDepth ?? 2,
    maxStringLength: config.maxStringLength ?? 200,
  });
}

/**
 * @LogResponseMeta - Extracts specified fields from response for logging.
 *
 * IMPORTANT: Only use allowlist-based extraction. Never log entire response.
 *
 * @param paths - Array of dot-notation paths to extract from response
 *
 * @example
 * ```typescript
 * @Post()
 * @LogResponseMeta(['transactionId', 'orderId', 'status'])
 * async createPayment(@Body() dto: PaymentDto) { ... }
 * ```
 *
 * @example With config object
 * ```typescript
 * @Get()
 * @LogResponseMeta({ paths: ['items.length', 'totalCount'], maxDepth: 1 })
 * async listItems() { ... }
 * ```
 */
export function LogResponseMeta(pathsOrConfig: string[] | LogMetaConfig) {
  const config: LogMetaConfig = Array.isArray(pathsOrConfig)
    ? { paths: pathsOrConfig }
    : pathsOrConfig;

  return SetMetadata(LOG_RESPONSE_META_KEY, {
    paths: config.paths,
    maxDepth: config.maxDepth ?? 2,
    maxStringLength: config.maxStringLength ?? 200,
  });
}
