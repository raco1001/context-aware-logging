import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { MqProducerPort } from "@logging/out-ports";
import { WideEvent } from "@logging/domain";
import { LoggingContext } from "@logging/domain";
import { KafkaProducerClient } from "./kafka-producer.client";

/**
 * KafkaProducer - Kafka implementation of MqProducerPort.
 * Publishes log events to Kafka topic for asynchronous processing.
 *
 * This adapter uses KafkaProducerClient for Kafka connection management.
 * Pattern: Follows the same pattern as VoyageAdapter using VoyageClient.
 */
@Injectable()
export class KafkaProducer extends MqProducerPort {
  private readonly logger = new Logger(KafkaProducer.name);
  private readonly topic: string;

  constructor(
    private readonly kafkaProducerClient: KafkaProducerClient,
    private readonly configService: ConfigService,
  ) {
    super();
    this.topic =
      this.configService.get<string>("KAFKA_LOG_TOPIC") || "log-events";
  }

  async connect(): Promise<void> {
    if (!this.kafkaProducerClient.isProducerConnected()) {
      await this.kafkaProducerClient.connect();
    }
  }

  async disconnect(): Promise<void> {
    await this.kafkaProducerClient.disconnect();
  }

  async publish(
    event: WideEvent,
    metadata: LoggingContext["_metadata"],
    summary: string,
  ): Promise<void> {
    if (!this.kafkaProducerClient.isProducerConnected()) {
      throw new Error("Kafka producer is not connected");
    }

    try {
      const message = {
        event,
        _metadata: metadata || {},
        summary,
        timestamp: new Date().toISOString(),
      };

      const producer = this.kafkaProducerClient.getProducer();
      await producer.send({
        topic: this.topic,
        messages: [
          {
            key: event.requestId, // Use requestId as key for partitioning
            value: JSON.stringify(message),
          },
        ],
      });

      this.logger.debug(
        `Published log event to Kafka topic: ${this.topic}, requestId: ${event.requestId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to publish log event to Kafka: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }
}
