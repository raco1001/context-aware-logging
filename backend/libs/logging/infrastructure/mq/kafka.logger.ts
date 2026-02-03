import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerPort } from '@logging/out-ports';
import { WideEvent, LoggingContext } from '@logging/domain';
import { LoggingMode } from '../../core/domain/logging-mode.enum';
import { MqProducerPort } from '@logging/out-ports';
import { LoggingModeService } from '@logging/service';

/**
 * KafkaLogger - LoggerPort wrapper that publishes to Kafka instead of directly logging.
 *
 * Core Philosophy:
 * - The status machine (LoggingModeService) determines the logging mode.
 * - KAFKA MODE: Asynchronous logging via Kafka Producer
 * - DIRECT MODE: Direct logging to MongoDB (Fallback if Kafka fails)
 *
 * This adapter decouples logging from application performance by:
 * 1. Publishing events to Kafka (non-blocking)
 * 2. Falling back to direct logging if Kafka is unavailable
 *
 * The actual persistence is handled by MqConsumerService in the background.
 */
@Injectable()
export class KafkaLogger extends LoggerPort {
  private readonly logger = new Logger(KafkaLogger.name);
  private readonly mqEnabled: boolean;
  private readonly fallbackLogger: LoggerPort | undefined;

  constructor(
    private readonly mqProducer: MqProducerPort,
    @Optional() @Inject(LoggerPort) fallbackLogger: LoggerPort | undefined,
    private readonly loggingModeService: LoggingModeService,
    private readonly configService: ConfigService,
  ) {
    super();
    this.mqEnabled = this.configService.get<string>('MQ_ENABLED') === 'true';
    this.fallbackLogger = fallbackLogger;

    if (!this.fallbackLogger) {
      this.logger.warn(
        'No fallback logger provided. Logs will be lost if MQ fails.',
      );
    }
  }

  async log(
    event: WideEvent,
    _metadata: LoggingContext['_metadata'],
    _summary: string,
  ): Promise<void> {
    // If MQ is disabled, use the fallback logger
    if (!this.mqEnabled) {
      if (this.fallbackLogger) {
        return this.fallbackLogger.log(event, _metadata, _summary);
      }
      this.logger.warn(
        'MQ disabled and no fallback logger available. Log dropped.',
      );
      return;
    }

    // Check the status machine
    const mode = this.loggingModeService.getMode();

    if (mode === LoggingMode.DIRECT) {
      // DIRECT MODE: Use the fallback logger immediately
      if (this.fallbackLogger) {
        return this.fallbackLogger.log(event, _metadata, _summary);
      }
      this.logger.warn('DIRECT mode but no fallback logger. Log lost.');
      return;
    }

    // KAFKA MODE: Try to use the producer
    if (!this.mqProducer.isConnected()) {
      // If the producer is not connected, change the mode
      this.logger.warn('Producer not connected. Switching to DIRECT mode...');
      this.loggingModeService.setMode(LoggingMode.DIRECT);

      if (this.fallbackLogger) {
        return this.fallbackLogger.log(event, _metadata, _summary);
      }
      this.logger.warn(
        'MQ producer not connected and no fallback logger available. Log lost.',
      );
      return;
    }

    try {
      await this.mqProducer.publish(event, _metadata, _summary);
    } catch (error) {
      this.logger.warn(
        `MQ publish failed: ${error.message}. Switching to DIRECT mode...`,
      );

      // If failed, change the mode
      this.loggingModeService.setMode(LoggingMode.DIRECT);

      if (this.fallbackLogger) {
        try {
          await this.fallbackLogger.log(event, _metadata, _summary);
        } catch (fallbackError) {
          this.logger.error(
            `Fallback logging also failed: ${fallbackError.message}`,
            fallbackError.stack,
          );
        }
      } else {
        this.logger.error(
          `MQ failed and no fallback logger available. Log lost for requestId: ${event.requestId}`,
        );
      }
    }
  }
}
