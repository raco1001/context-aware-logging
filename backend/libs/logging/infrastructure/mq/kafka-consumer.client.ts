import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Kafka, Consumer, logLevel } from "kafkajs";
import * as net from "net";

/**
 * KafkaConsumerClient - Infrastructure client for managing Kafka Consumer lifecycle.
 *
 * Core principles:
 * - Consumer is treated as an "ephemeral worker".
 * - Only creates Consumer instances when Kafka is available.
 * - Completely destroys Consumer instances when Kafka fails (set to null).
 *
 * Pattern: Lazy Lifecycle Management
 * - Consumer is created only when needed (createAndConnect).
 * - Completely destroyed when Kafka fails (destroy).
 * - Watchdog operates completely independently of the Consumer, checking only broker availability.
 */
@Injectable()
export class KafkaConsumerClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaConsumerClient.name);
  private kafka: Kafka;
  private consumer: Consumer | null = null;
  private readonly broker: string;
  private readonly groupId: string;

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

    this.logger.log(
      `Kafka Consumer client initialized (lazy). Broker: ${this.broker}, Group: ${this.groupId}`,
    );
  }

  async onModuleInit(): Promise<void> {
    // The Consumer is created by calling createAndConnect() when MqConsumerService needs it.
    this.logger.log("Kafka Consumer client ready (lazy initialization)");
  }

  async onModuleDestroy(): Promise<void> {
    await this.destroy();
  }

  /**
   * Creates and connects the Consumer instance.
   * Only called when Kafka is available.
   *
   * @throws Error if the Consumer already exists
   */
  async createAndConnect(): Promise<Consumer> {
    if (this.consumer) {
      throw new Error(
        "Consumer already exists. Destroy it first before creating a new one.",
      );
    }

    this.logger.log("Creating new Consumer instance...");

    this.consumer = this.kafka.consumer({
      groupId: this.groupId,
      sessionTimeout: 30000,
      heartbeatInterval: 3000,
    });

    const { CONNECT, DISCONNECT } = this.consumer.events;
    this.consumer.on(CONNECT, () => {
      this.logger.log("Kafka Consumer connected");
    });

    this.consumer.on(DISCONNECT, () => {
      this.logger.warn("Kafka Consumer disconnected");
    });

    await this.consumer.connect();
    this.logger.log(
      `Consumer created and connected to Kafka broker at ${this.broker}`,
    );

    return this.consumer;
  }

  /**
   * Completely destroys the Consumer instance.
   * After calling disconnect(), it must be set to null to be eligible for GC.
   *
   * This method is called when Kafka fails to clean up all internal loops of the Consumer.
   */
  async destroy(): Promise<void> {
    if (!this.consumer) {
      return;
    }

    try {
      this.logger.log("Destroying Consumer instance...");
      await this.consumer.disconnect();
      this.logger.log("Consumer disconnected");
    } catch (error) {
      this.logger.warn(
        `Consumer disconnect error (may already be disconnected): ${error.message}`,
      );
    } finally {
      this.consumer = null;
      this.logger.log("Consumer instance destroyed (GC eligible)");
    }
  }

  /**
   * Checks if the Consumer instance exists.
   */
  hasConsumer(): boolean {
    return this.consumer !== null;
  }

  /**
   * Returns the Consumer instance.
   *
   * @throws Error if consumer is null
   */
  getConsumer(): Consumer {
    if (!this.consumer) {
      throw new Error(
        "Consumer instance does not exist. Create it first using createAndConnect().",
      );
    }
    return this.consumer;
  }

  /**
   *  Check Kafka broker availability via TCP.
   *
   * This method operates completely independently of the Consumer.
   * The Watchdog uses this method to check broker availability only.
   */
  async checkBrokerAvailability(): Promise<boolean> {
    return new Promise((resolve) => {
      const [host, portStr] = this.broker.split(":");
      const port = parseInt(portStr || "9092", 10);

      const socket = net.createConnection({ host, port, timeout: 1000 });

      socket.on("connect", () => {
        socket.destroy();
        resolve(true);
      });

      socket.on("error", () => {
        socket.destroy();
        resolve(false);
      });

      socket.on("timeout", () => {
        socket.destroy();
        resolve(false);
      });
    });
  }

  /**
   * Returns the configured consumer group ID.
   */
  getGroupId(): string {
    return this.groupId;
  }
}
