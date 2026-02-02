import { Injectable, Logger } from '@nestjs/common';
import { LoggingMode } from '@logging/domain';

/**
 * LoggingModeService - A service that manages the logging mode.
 *
 * When Kafka fails, automatically switch to DIRECT mode and when Kafka recovers, switch back to KAFKA mode.
 */
@Injectable()
export class LoggingModeService {
  private readonly logger = new Logger(LoggingModeService.name);
  private mode: LoggingMode = LoggingMode.KAFKA;
  private modeChangeCallbacks: Array<(mode: LoggingMode) => void> = [];

  /**
   * Return the current logging mode.
   */
  getMode(): LoggingMode {
    return this.mode;
  }

  /**
   * Change the logging mode and call the registered callbacks.
   */
  setMode(mode: LoggingMode): void {
    if (this.mode !== mode) {
      const previousMode = this.mode;
      this.mode = mode;
      this.logger.log(`Logging mode changed: ${previousMode} → ${mode}`);
      this.notifyModeChange(mode);
    }
  }

  /**
   * Register a callback that will be called when the mode changes.
   */
  onModeChange(callback: (mode: LoggingMode) => void): void {
    this.modeChangeCallbacks.push(callback);
  }

  /**
   * Notify all registered callbacks of the mode change.
   */
  private notifyModeChange(mode: LoggingMode): void {
    this.modeChangeCallbacks.forEach((cb) => {
      try {
        cb(mode);
      } catch (error) {
        this.logger.error(
          `Error in mode change callback: ${error.message}`,
          error.stack,
        );
      }
    });
  }
}
