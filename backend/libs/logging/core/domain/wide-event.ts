import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsEnum,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { UserRole, LatencyBucket } from '../value-objects';
import { Latency } from './latency';
import type { LoggingContext } from './context';

export class WideEventUser {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsEnum(UserRole)
  role: UserRole;

  constructor(id: string, role: UserRole) {
    this.id = id;
    this.role = role;
  }

  /**
   * Create WideEventUser from a plain object with string role.
   * Handles conversion from LoggingContext's user format.
   */
  static fromPlain(user: { id: string; role: string }): WideEventUser {
    const roleValue = Object.values(UserRole).includes(user.role as UserRole)
      ? (user.role as UserRole)
      : UserRole.GUEST;
    return new WideEventUser(user.id, roleValue);
  }
}

export class WideEventError {
  /**
   * The error code can be a global ErrorCode or a domain-specific string.
   * This allows the logging library to remain generic while accommodating
   * various business logic needs.
   */
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  message: string;

  constructor(code: string, message: string) {
    this.code = code;
    this.message = message;
  }
}

export class WideEventPerformance {
  @IsNumber()
  durationMs: number;

  constructor(durationMs: number) {
    this.durationMs = durationMs;
  }
}

/**
 * WideEvent - The single unit of truth for logging across all phases.
 *
 * Rich domain model with behavior:
 * - toSummary(): Generate deterministic text representation for embeddings
 * - fromContext(): Factory method to create from LoggingContext
 */
export class WideEvent {
  @IsString()
  @IsNotEmpty()
  public readonly requestId: string;

  @IsString()
  @IsNotEmpty()
  public readonly timestamp: string;

  @IsString()
  @IsNotEmpty()
  public readonly service: string;

  @IsString()
  @IsNotEmpty()
  public readonly route: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => WideEventUser)
  public readonly user?: WideEventUser;

  @IsOptional()
  @ValidateNested()
  @Type(() => WideEventError)
  public readonly error?: WideEventError;

  @IsOptional()
  @ValidateNested()
  @Type(() => WideEventPerformance)
  public readonly performance?: WideEventPerformance;

  constructor(
    requestId: string,
    timestamp: string,
    service: string,
    route: string,
    user?: WideEventUser,
    error?: WideEventError,
    performance?: WideEventPerformance,
  ) {
    this.requestId = requestId;
    this.timestamp = timestamp;
    this.service = service;
    this.route = route;
    this.user = user;
    this.error = error;
    this.performance = performance;
  }

  /**
   * Factory method to create WideEvent from LoggingContext.
   * Handles type conversion and ensures domain integrity.
   */
  static fromContext(context: LoggingContext): WideEvent {
    return new WideEvent(
      context.requestId,
      context.timestamp,
      context.service,
      context.route,
      context.user ? WideEventUser.fromPlain(context.user) : undefined,
      context.error
        ? new WideEventError(context.error.code, context.error.message)
        : undefined,
      context.performance
        ? new WideEventPerformance(context.performance.durationMs)
        : undefined,
    );
  }

  /**
   * Factory method to create WideEvent from a stored document (e.g., MongoDB).
   * Handles partial/nullable fields from database.
   */
  static fromDocument(doc: {
    requestId: string;
    timestamp: string | Date;
    service: string;
    route: string;
    user?: { id: string; role: string };
    error?: { code: string; message: string };
    performance?: { durationMs: number };
  }): WideEvent {
    const timestamp =
      doc.timestamp instanceof Date
        ? doc.timestamp.toISOString()
        : doc.timestamp;

    return new WideEvent(
      doc.requestId,
      timestamp,
      doc.service,
      doc.route,
      doc.user ? WideEventUser.fromPlain(doc.user) : undefined,
      doc.error
        ? new WideEventError(doc.error.code, doc.error.message)
        : undefined,
      doc.performance
        ? new WideEventPerformance(doc.performance.durationMs)
        : undefined,
    );
  }

  /**
   * Deterministic Semantic Serialization.
   * Generates a stable text representation for vector embeddings.
   *
   * The outcome is determined by:
   * - FAILED: Has error
   * - WARNING: Latency over 1000ms
   * - EDGE_CASE: Unknown latency
   * - SUCCESS: Normal completion
   */
  toSummary(): string {
    const errorCode = this.error?.code ?? 'NONE';
    const errorMessage = this.error?.message ?? 'NONE';
    const userRole = this.user?.role ?? 'ANONYMOUS';
    const latencyBucket = Latency.getBucket(this.performance?.durationMs);
    const outcome = this.determineOutcome(latencyBucket);

    return `Outcome: ${outcome}, Service: ${this.service}, Route: ${this.route}, Error: ${errorCode}, ErrorMessage: ${errorMessage}, UserRole: ${userRole}, LatencyBucket: ${latencyBucket}`;
  }

  /**
   * Determine the outcome based on error and latency.
   */
  private determineOutcome(latencyBucket: LatencyBucket): string {
    if (this.error) {
      return 'FAILED';
    }
    if (latencyBucket === LatencyBucket.P_OVER_1000MS) {
      return 'WARNING';
    }
    if (latencyBucket === LatencyBucket.P_UNKNOWN) {
      return 'EDGE_CASE';
    }
    return 'SUCCESS';
  }
}
