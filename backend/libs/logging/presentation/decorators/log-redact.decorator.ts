import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key for redaction decorator
 */
export const LOG_REDACT_KEY = 'log_redact';

/**
 * Redaction configuration
 */
export interface LogRedactConfig {
  /** Paths to redact (e.g., ['body.password', 'headers.authorization']) */
  paths: string[];
  /** Replacement string (default: '[REDACTED]') */
  replacement?: string;
}

/**
 * Default paths that are always redacted for security
 */
export const DEFAULT_REDACT_PATHS = [
  'body.password',
  'body.currentPassword',
  'body.newPassword',
  'body.confirmPassword',
  'body.secret',
  'body.apiKey',
  'body.token',
  'body.accessToken',
  'body.refreshToken',
  'body.cardNumber',
  'body.cvv',
  'body.ssn',
  'headers.authorization',
  'headers.cookie',
  'headers.x-api-key',
];

/**
 * @LogRedact - Specifies paths to redact (mask) in logs.
 *
 * IMPORTANT: Always use this for sensitive data. Default sensitive paths
 * are automatically redacted, but you should explicitly declare any
 * domain-specific sensitive fields.
 *
 * @param pathsOrConfig - Array of paths or config object
 *
 * @example Basic usage
 * ```typescript
 * @Post()
 * @LogRedact(['body.creditCard', 'body.socialSecurityNumber'])
 * async sensitiveOperation(@Body() dto: SensitiveDto) { ... }
 * ```
 *
 * @example With custom replacement
 * ```typescript
 * @Post()
 * @LogRedact({ paths: ['body.pin'], replacement: '****' })
 * async verifyPin(@Body() dto: PinDto) { ... }
 * ```
 *
 * @example Combining with @LogRequestMeta
 * ```typescript
 * @Post()
 * @LogRequestMeta(['body.username', 'body.password', 'body.email'])
 * @LogRedact(['body.password'])  // password will be '[REDACTED]'
 * async register(@Body() dto: RegisterDto) { ... }
 * ```
 */
export function LogRedact(pathsOrConfig: string[] | LogRedactConfig) {
  const config: LogRedactConfig = Array.isArray(pathsOrConfig)
    ? { paths: pathsOrConfig }
    : pathsOrConfig;

  return SetMetadata(LOG_REDACT_KEY, {
    paths: [...DEFAULT_REDACT_PATHS, ...config.paths],
    replacement: config.replacement ?? '[REDACTED]',
  });
}
