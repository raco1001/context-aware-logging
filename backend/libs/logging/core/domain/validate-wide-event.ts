import { validate, type ValidationError } from 'class-validator';
import { WideEvent } from './wide-event';

export interface ValidateWideEventResult {
  ok: boolean;
  errors: ValidationError[];
  warnings: string[];
}

export interface ValidateWideEventOptions {
  /**
   * Allowlist of canonical service names.
   * If provided and the event's service is not in the list, a warning is emitted.
   */
  serviceAllowlist?: readonly string[];
}

export async function validateWideEvent(
  event: WideEvent,
  options: ValidateWideEventOptions = {},
): Promise<ValidateWideEventResult> {
  const errors: ValidationError[] = await validate(event, {
    whitelist: false,
    forbidUnknownValues: true,
    validationError: { target: false, value: false },
  });

  const warnings: string[] = [];

  // Semantic validations (lightweight, current-scale rules).
  if (!(event.timestamp instanceof Date) || Number.isNaN(event.timestamp.getTime())) {
    warnings.push('timestamp is not a valid Date');
    // Treat as an error via a synthetic ValidationError-like entry.
    errors.push({
      property: 'timestamp',
      constraints: { isDate: 'timestamp must be a valid Date' },
      children: [],
    } as ValidationError);
  }

  if (event.error) {
    const code = event.error.code?.trim?.() ?? '';
    const message = event.error.message?.trim?.() ?? '';
    if (!code || !message) {
      errors.push({
        property: 'error',
        constraints: {
          isNotEmpty:
            'when error is present, error.code and error.message must be non-empty',
        },
        children: [],
      } as ValidationError);
    }
  }

  if (options.serviceAllowlist && options.serviceAllowlist.length > 0) {
    if (!options.serviceAllowlist.includes(event.service)) {
      warnings.push(`service not in allowlist: "${event.service}"`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

