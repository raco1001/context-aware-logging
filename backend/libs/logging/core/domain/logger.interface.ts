import { WideEvent } from './wide-event';

/**
 * Logger interface - defines the contract for logging implementations.
 * This interface must not change, even when storage changes.
 */
export interface Logger {
  log(event: WideEvent): Promise<void>;
}
