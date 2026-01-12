import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Kafka, Producer, logLevel } from "kafkajs";
import * as net from "net";

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
  private watchdogTimer: NodeJS.Timeout | null = null;
  private consecutiveSuccessCount = 0;
  private readonly STABILITY_THRESHOLD = 3;

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

    const { CONNECT, DISCONNECT } = this.producer.events;
    this.producer.on(CONNECT, () => {
      this.isConnected = true;
      this.logger.log("Kafka Producer connected");
    });
    this.producer.on(DISCONNECT, () => {
      this.isConnected = false;
      this.logger.warn("Kafka Producer disconnected");
      this.startWatchdog();
    });

    this.logger.log(
      `Kafka Producer client initialized for broker: ${this.broker}`,
    );
  }

  async onModuleInit(): Promise<void> {
    this.initialConnect();
  }

  private async initialConnect(): Promise<void> {
    try {
      const isAvailable = await this.checkBrokerAvailability();
      if (!isAvailable) {
        throw new Error("Broker not reachable via TCP");
      }
      await this.connect();
    } catch (error) {
      this.logger.warn(
        `Kafka Broker(${this.broker}) unavailable at startup. Operating in fallback mode. Error: ${error.message}`,
      );
      this.isConnected = false;
      this.startWatchdog();
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stopWatchdog();
    await this.disconnect();
  }

  private startWatchdog(): void {
    if (this.watchdogTimer) return;
    this.consecutiveSuccessCount = 0;

    this.watchdogTimer = setInterval(async () => {
      try {
        const isAvailable = await this.checkBrokerAvailability();
        if (isAvailable) {
          this.consecutiveSuccessCount++;
          this.logger.debug(
            `Watchdog: Kafka available (${this.consecutiveSuccessCount}/${this.STABILITY_THRESHOLD})`,
          );

          if (this.consecutiveSuccessCount >= this.STABILITY_THRESHOLD) {
            this.logger.log(
              "Watchdog: Kafka Broker is stable. Reconnecting...",
            );
            this.consecutiveSuccessCount = 0;
            await this.connect();
            this.stopWatchdog();
          }
        } else {
          this.consecutiveSuccessCount = 0;
          this.logger.debug("Watchdog: Kafka Broker is still offline.");
        }
      } catch (error) {
        this.consecutiveSuccessCount = 0;
      }
    }, 30000);
  }

  private stopWatchdog(): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
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
   * Performs a silent TCP check to see if the Kafka broker is available.
   * This avoids triggering heavy KafkaJS connection logic and error logging.
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

  /**
   * Manually trigger a connection check and update status.
   * Useful when an external call fails.
   */
  async triggerHealthCheck(): Promise<boolean> {
    const isAvailable = await this.checkBrokerAvailability();
    if (!isAvailable && this.isConnected) {
      this.isConnected = false;
      this.logger.warn(
        "Kafka Producer status updated to disconnected after health check",
      );
      this.startWatchdog();
    }
    return isAvailable;
  }
}
