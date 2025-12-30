import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsObject,
  IsNumber,
  IsEnum,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { UserRole } from '../value-objects';

export class WideEventUser {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsEnum(UserRole)
  role: UserRole;
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
}

export class WideEventPerformance {
  @IsNumber()
  durationMs: number;
}

/**
 * WideEvent - The single unit of truth for logging across all phases.
 *
 * Converted to a class to support runtime type checking and validation.
 */
export class WideEvent {
  @IsString()
  @IsNotEmpty()
  public requestId: string;

  @IsString()
  @IsNotEmpty()
  public timestamp: string;

  @IsString()
  @IsNotEmpty()
  public service: string;

  @IsString()
  @IsNotEmpty()
  public route: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => WideEventUser)
  public user?: WideEventUser;

  @IsOptional()
  @ValidateNested()
  @Type(() => WideEventError)
  public error?: WideEventError;

  @IsOptional()
  @ValidateNested()
  @Type(() => WideEventPerformance)
  public performance?: WideEventPerformance;

  @IsOptional()
  @IsObject()
  public metadata?: Record<string, any>;

  constructor(partial: Partial<WideEvent>) {
    Object.assign(this, partial);
  }
}
