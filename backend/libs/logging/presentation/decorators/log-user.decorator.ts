import { SetMetadata } from '@nestjs/common';

/**
 * Metadata keys for user logging decorators
 */
export const LOG_USER_KEY = 'log_user';
export const LOG_USER_FROM_REQUEST_KEY = 'log_user_from_request';

/**
 * Configuration for extracting user information from request
 */
export interface LogUserConfig {
  /** Path to user ID in request (e.g., 'body.userId', 'params.id') */
  id: string;
  /** Path to user role in request (e.g., 'body.role', 'headers.x-user-role') */
  role: string;
}

/**
 * @LogUser - Extracts user context from specified request paths.
 *
 * Use this when user information is in the request body, params, or headers.
 *
 * @example
 * ```typescript
 * @Post()
 * @LogUser({ id: 'body.userId', role: 'body.role' })
 * async createOrder(@Body() dto: CreateOrderDto) { ... }
 * ```
 *
 * @example
 * ```typescript
 * @Get(':userId')
 * @LogUser({ id: 'params.userId', role: 'headers.x-user-role' })
 * async getUser(@Param('userId') userId: string) { ... }
 * ```
 */
export const LogUser = (config: LogUserConfig) =>
  SetMetadata(LOG_USER_KEY, config);

/**
 * @LogUserFromRequest - Automatically extracts user from req.user (Express).
 *
 * Use this when authentication middleware populates req.user.
 * Expects req.user to have { id: string, role: string } shape.
 *
 * @example
 * ```typescript
 * @Post()
 * @UseGuards(AuthGuard)
 * @LogUserFromRequest()
 * async protectedEndpoint() { ... }
 * ```
 */
export const LogUserFromRequest = () =>
  SetMetadata(LOG_USER_FROM_REQUEST_KEY, true);
