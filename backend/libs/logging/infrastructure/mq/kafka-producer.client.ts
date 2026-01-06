import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Kafka, Producer, logLevel } from "kafkajs";

/**
 * KafkaProducerClient - Infrastructure client for initializing and managing Kafka Producer.
 * This class is responsible solely for client initialization, configuration, and connection management.
 * Actual publish operations are delegated to adapters that use this client instance.
 *
 * Pattern: Follows the same pattern as VoyageClient and GeminiClient.
 */
@Injectable()
export class KafkaProducerClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaProducerClient.name);
  private kafka: Kafka;
  private producer: Producer;
  private readonly broker: string;
  private isConnected = false;

  constructor(private readonly configService: ConfigService) {
    this.broker =
      this.configService.get<string>("MQ_BROKER_ADDRESS") || "localhost:9092";

    this.kafka = new Kafka({
      clientId: "logging-service",
      brokers: [this.broker],
      logLevel: logLevel.ERROR,
    });

    this.producer = this.kafka.producer({
      maxInFlightRequests: 1,
      idempotent: true,
      retry: {
        retries: 3,
        initialRetryTime: 100,
        multiplier: 2,
      },
    });

    this.logger.log(
      `Kafka Producer client initialized for broker: ${this.broker}`,
    );
  }

  async onModuleInit(): Promise<void> {
    await this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.disconnect();
  }

  /**
   * Connect to Kafka broker.
   */
  async connect(): Promise<void> {
    if (this.isConnected) {
      return;
    }

    try {
      await this.producer.connect();
      this.isConnected = true;
      this.logger.log(`Connected to Kafka broker at ${this.broker}`);
    } catch (error) {
      this.logger.error(
        `Failed to connect to Kafka: ${error.message}`,
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
      this.logger.log(
        "Graceful shutdown: Disconnecting Kafka Producer (flushing pending messages)...",
      );
      await this.producer.disconnect();
      this.isConnected = false;
      this.logger.log("Disconnected from Kafka successfully");
    } catch (error) {
      this.logger.error(
        `Error disconnecting from Kafka: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Returns the initialized Kafka Producer instance.
   * This is the single source of truth for the Kafka Producer.
   *
   * @throws Error if producer is not connected
   */
  getProducer(): Producer {
    if (!this.isConnected) {
      throw new Error("Kafka producer is not connected");
    }
    return this.producer;
  }

  /**
   * Returns the connection status.
   */
  isProducerConnected(): boolean {
    return this.isConnected;
  }
}
