import { WideEvent } from "@logging/domain";
import { LoggingContext } from "@logging/domain";

/**
 * MQ Client Port - Interface for message queue operations.
 * Allows swapping between Kafka, Redis Streams, RabbitMQ, etc.
 */
export abstract class MqProducerPort {
  /**
   * Publish a log event to the message queue (non-blocking).
   * @param event WideEvent to publish
   * @param metadata Logging metadata
   * @param summary Log summary string
   */
  abstract publish(
    event: WideEvent,
    metadata: LoggingContext["_metadata"],
    summary: string,
  ): Promise<void>;

  /**
   * Connect to the message queue.
   */
  abstract connect(): Promise<void>;

  /**
   * Disconnect from the message queue.
   */
  abstract disconnect(): Promise<void>;
}
