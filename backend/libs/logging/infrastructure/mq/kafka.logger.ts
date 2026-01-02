import { Injectable, Logger, Optional, Inject } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { LoggerPort } from "@logging/out-ports";
import { WideEvent } from "@logging/domain";
import { LoggingContext } from "@logging/domain";
import { MqProducerPort } from "@logging/out-ports";

/**
 * KafkaLogger - LoggerPort wrapper that publishes to Kafka instead of directly logging.
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
    private readonly configService: ConfigService,
  ) {
    super();
    this.mqEnabled = this.configService.get<string>("MQ_ENABLED") === "true";
    this.fallbackLogger = fallbackLogger;

    if (!this.fallbackLogger) {
      this.logger.warn(
        "No fallback logger provided. Logs will be lost if MQ fails.",
      );
    }
  }

  async log(
    event: WideEvent,
    _metadata: LoggingContext["_metadata"],
    _summary: string,
  ): Promise<void> {
    // If MQ is disabled, use fallback logger directly
    if (!this.mqEnabled) {
      if (this.fallbackLogger) {
        return this.fallbackLogger.log(event, _metadata, _summary);
      }
      this.logger.warn(
        "MQ disabled and no fallback logger available. Log dropped.",
      );
      return;
    }

    try {
      // Publish to MQ (non-blocking)
      await this.mqProducer.publish(event, _metadata, _summary);
    } catch (error) {
      this.logger.warn(
        `MQ publish failed, falling back to direct logging: ${error.message}`,
      );

      // Fallback to direct logging
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
