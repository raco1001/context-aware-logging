import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Structured error metadata for detailed error analysis.
 * Separated from main error to keep log queries simple.
 */
export interface ErrorMeta {
  /** HTTP status code (if applicable) */
  httpStatus?: number;
  /** Exception class name (e.g., 'BadRequestException', 'TypeError') */
  exceptionName?: string;
  /** Original raw response from HttpException.getResponse() */
  rawResponse?: unknown;
  /** Validation errors if response was an array */
  validationErrors?: string[];
  /** Stack trace (only in development, truncated) */
  stack?: string;
}

/**
 * Normalized error structure for consistent logging.
 */
export interface NormalizedError {
  /** Stable error code for grouping/querying */
  code: string;
  /** Short, stable error message */
  message: string;
  /** Detailed error metadata (stored in _metadata) */
  _errorMeta: ErrorMeta;
}

/**
 * ErrorNormalizer - Normalizes various error types to a consistent structure.
 *
 * This belongs in the presentation layer because it depends on NestJS HttpException.
 *
 * Problem:
 * - HttpException.getResponse() returns string | object | array
 * - Error messages are inconsistent across different error sources
 * - Detailed error info mixed with simple error code/message
 *
 * Solution:
 * - Extract stable code and short message for main error fields
 * - Store detailed metadata separately in _errorMeta
 * - Handle all error types consistently
 */
export class ErrorNormalizer {
  /** Maximum message length to prevent log bloat */
  private static readonly MAX_MESSAGE_LENGTH = 200;
  /** Maximum stack trace lines in development */
  private static readonly MAX_STACK_LINES = 5;
  /** Whether to include stack traces */
  private static readonly INCLUDE_STACK = process.env.NODE_ENV !== 'production';

  /**
   * Normalize any error to a consistent structure.
   */
  static normalize(error: unknown): NormalizedError {
    if (error instanceof HttpException) {
      return this.normalizeHttpException(error);
    }

    if (error instanceof Error) {
      return this.normalizeError(error);
    }

    return this.normalizeUnknown(error);
  }

  /**
   * Normalize NestJS HttpException.
   */
  private static normalizeHttpException(error: HttpException): NormalizedError {
    const status = error.getStatus();
    const response = error.getResponse();

    return {
      code: this.extractCode(response, status),
      message: this.extractMessage(response, error.message),
      _errorMeta: {
        httpStatus: status,
        exceptionName: error.constructor.name,
        rawResponse: this.sanitizeResponse(response),
        validationErrors: this.extractValidationErrors(response),
        stack: this.getStack(error),
      },
    };
  }

  /**
   * Normalize standard Error.
   */
  private static normalizeError(error: Error): NormalizedError {
    const code =
      (error as any).code ||
      (error as any).status?.toString() ||
      error.constructor.name ||
      'UNKNOWN';

    return {
      code: String(code),
      message: this.truncateMessage(error.message || 'Unknown error'),
      _errorMeta: {
        exceptionName: error.constructor.name,
        stack: this.getStack(error),
      },
    };
  }

  /**
   * Normalize unknown error type.
   */
  private static normalizeUnknown(error: unknown): NormalizedError {
    const message =
      typeof error === 'string'
        ? error
        : typeof error === 'object' && error !== null
          ? JSON.stringify(error).slice(0, this.MAX_MESSAGE_LENGTH)
          : 'Unknown error';

    return {
      code: 'UNKNOWN',
      message: this.truncateMessage(message),
      _errorMeta: {
        rawResponse: error,
      },
    };
  }

  /**
   * Extract error code from HttpException response.
   */
  private static extractCode(response: unknown, status: number): string {
    if (typeof response === 'object' && response !== null) {
      const obj = response as Record<string, unknown>;
      // Check common error code field names
      const code =
        obj.errorCode || obj.code || obj.error || obj.statusCode || status;
      return String(code);
    }

    // Map HTTP status to code
    return this.httpStatusToCode(status);
  }

  /**
   * Map HTTP status code to a stable error code string.
   */
  private static httpStatusToCode(status: number): string {
    const statusMap: Record<number, string> = {
      [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
      [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
      [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
      [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
      [HttpStatus.CONFLICT]: 'CONFLICT',
      [HttpStatus.UNPROCESSABLE_ENTITY]: 'VALIDATION_ERROR',
      [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
      [HttpStatus.INTERNAL_SERVER_ERROR]: 'INTERNAL_ERROR',
      [HttpStatus.BAD_GATEWAY]: 'BAD_GATEWAY',
      [HttpStatus.SERVICE_UNAVAILABLE]: 'SERVICE_UNAVAILABLE',
      [HttpStatus.GATEWAY_TIMEOUT]: 'GATEWAY_TIMEOUT',
    };

    return statusMap[status] || `HTTP_${status}`;
  }

  /**
   * Extract message from HttpException response.
   */
  private static extractMessage(response: unknown, fallback: string): string {
    let message: string;

    if (typeof response === 'string') {
      message = response;
    } else if (Array.isArray(response)) {
      // Validation errors - join first few
      message = response.slice(0, 3).join('; ');
      if (response.length > 3) {
        message += `... (+${response.length - 3} more)`;
      }
    } else if (typeof response === 'object' && response !== null) {
      const obj = response as Record<string, unknown>;
      message = String(
        obj.errorMessage || obj.message || obj.error || fallback,
      );
    } else {
      message = fallback;
    }

    return this.truncateMessage(message);
  }

  /**
   * Extract validation errors from response array.
   */
  private static extractValidationErrors(
    response: unknown,
  ): string[] | undefined {
    if (Array.isArray(response)) {
      return response.map(String).slice(0, 10);
    }

    if (typeof response === 'object' && response !== null) {
      const obj = response as Record<string, unknown>;
      if (Array.isArray(obj.message)) {
        return obj.message.map(String).slice(0, 10);
      }
      if (Array.isArray(obj.errors)) {
        return obj.errors.map(String).slice(0, 10);
      }
    }

    return undefined;
  }

  /**
   * Sanitize response for safe storage.
   * Removes circular references and limits size.
   */
  private static sanitizeResponse(response: unknown): unknown {
    if (response === null || response === undefined) {
      return response;
    }

    try {
      // Attempt to stringify and parse to remove circular references
      const str = JSON.stringify(response);
      if (str.length > 1000) {
        return JSON.parse(str.slice(0, 1000) + '..."');
      }
      return JSON.parse(str);
    } catch {
      // If stringify fails, return string representation
      return String(response).slice(0, 500);
    }
  }

  /**
   * Get truncated stack trace if enabled.
   */
  private static getStack(error: Error): string | undefined {
    if (!this.INCLUDE_STACK || !error.stack) {
      return undefined;
    }

    const lines = error.stack.split('\n');
    return lines.slice(0, this.MAX_STACK_LINES + 1).join('\n');
  }

  /**
   * Truncate message to maximum length.
   */
  private static truncateMessage(message: string): string {
    if (message.length <= this.MAX_MESSAGE_LENGTH) {
      return message;
    }
    return message.slice(0, this.MAX_MESSAGE_LENGTH - 3) + '...';
  }
}
