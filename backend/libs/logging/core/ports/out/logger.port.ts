import { WideEvent } from "@logging/domain/index";
import { LoggingContext } from "@logging/domain/index";
/**
 * Logger interface - defines the contract for logging implementations.
 * This interface must not change, even when storage changes.
 */
export abstract class LoggerPort {
  abstract log(
    event: WideEvent,
    _metadata: LoggingContext["_metadata"],
    _summary: string,
  ): Promise<void>;
}
