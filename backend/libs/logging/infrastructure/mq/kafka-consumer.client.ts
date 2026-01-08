import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Kafka, Consumer, logLevel } from "kafkajs";

/**
 * KafkaConsumerClient - Infrastructure client for initializing and managing Kafka Consumer.
 * This class is responsible solely for client initialization, configuration, and connection management.
 * Actual consume operations are delegated to services that use this client instance.
 *
 * Pattern: Follows the same pattern as VoyageClient and GeminiClient.
 */
@Injectable()
export class KafkaConsumerClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaConsumerClient.name);
  private kafka: Kafka;
  private consumer: Consumer;
  private readonly broker: string;
  private readonly groupId: string;
  private isConnected = false;

  constructor(private readonly configService: ConfigService) {
    this.broker =
      this.configService.get<string>("MQ_BROKER_ADDRESS") || "localhost:9092";
    this.groupId =
      this.configService.get<string>("MQ_CONSUMER_GROUP") ||
      "log-consumer-group";

    this.kafka = new Kafka({
      clientId: "log-consumer-service",
      brokers: [this.broker],
      logLevel: logLevel.ERROR,
    });

    this.consumer = this.kafka.consumer({
      groupId: this.groupId,
      sessionTimeout: 30000,
      heartbeatInterval: 3000,
    });

    this.logger.log(
      `Kafka Consumer client initialized for broker: ${this.broker}, group: ${this.groupId}`,
    );
  }

  async onModuleInit(): Promise<void> {}

  async onModuleDestroy(): Promise<void> {
    // Future:If it's still connected, the service might have failed to close it or wasn't used.
    if (this.isConnected) {
      this.logger.log(
        "onModuleDestroy: Forcefully disconnecting Kafka consumer client...",
      );
      await this.disconnect();
    }
  }

  /**
   * Connect to Kafka broker.
   */
  async connect(): Promise<void> {
    if (this.isConnected) {
      return;
    }

    try {
      await this.consumer.connect();
      this.isConnected = true;
      this.logger.log(`Connected to Kafka broker at ${this.broker}`);
    } catch (error) {
      this.logger.error(
        `Failed to connect to Kafka consumer: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Disconnect from Kafka broker.
   */
  async disconnect(): Promise<void> {
    if (!this.isConnected) {
      return;
    }

    try {
      this.logger.log("Disconnecting Kafka consumer...");
      // consumer.disconnect() internally calls consumer.stop()
      await this.consumer.disconnect();
      this.isConnected = false;
      this.logger.log("Disconnected from Kafka consumer successfully");
    } catch (error) {
      this.logger.error(
        `Error disconnecting from Kafka consumer: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Returns the initialized Kafka Consumer instance.
   * This is the single source of truth for the Kafka Consumer.
   *
   * @throws Error if consumer is not connected
   */
  getConsumer(): Consumer {
    if (!this.isConnected) {
      throw new Error("Kafka consumer is not connected");
    }
    return this.consumer;
  }

  /**
   * Returns the connection status.
   */
  isConsumerConnected(): boolean {
    return this.isConnected;
  }

  /**
   * Returns the configured consumer group ID.
   */
  getGroupId(): string {
    return this.groupId;
  }
}
