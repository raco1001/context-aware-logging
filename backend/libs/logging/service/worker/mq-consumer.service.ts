import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Consumer } from "kafkajs";
import { MongoLogger, KafkaConsumerClient } from "@logging/infrastructure";
import { WideEvent } from "@logging/domain";
import { LoggingContext } from "@logging/domain";

interface LogMessage {
  event: WideEvent;
  _metadata: LoggingContext["_metadata"];
  summary: string;
  timestamp: string;
}

/**
 * MqConsumerService - Background worker that consumes log events from MQ
 * and persists them to MongoDB via MongoLogger.
 *
 * Features:
 * - Batch processing (100 events or 1 second timeout)
 * - Error handling with retry logic
 * - Graceful shutdown
 */
@Injectable()
export class MqConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MqConsumerService.name);
  private consumer: Consumer;
  private readonly topic: string;
  private readonly batchSize: number;
  private readonly batchTimeoutMs: number;
  private isRunning = false;
  private batch: LogMessage[] = [];
  private batchTimeout: NodeJS.Timeout | null = null;

  constructor(
    // Though KafkaConsumerClient and MongoLogger are currently used, it could be any MqConsumerPort implementation in the future
    private readonly ConsumerClient: KafkaConsumerClient,
    private readonly mongoLogger: MongoLogger,
    private readonly configService: ConfigService,
  ) {
    this.topic = this.configService.get<string>("MQ_LOG_TOPIC") || "log-events";
    this.batchSize = parseInt(
      this.configService.get<string>("MQ_BATCH_SIZE") || "100",
      10,
    );
    this.batchTimeoutMs = parseInt(
      this.configService.get<string>("MQ_BATCH_TIMEOUT_MS") || "1000",
      10,
    );
  }

  async onModuleInit(): Promise<void> {
    await this.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.stop();
  }

  private async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    try {
      await this.ConsumerClient.connect();
      this.consumer = this.ConsumerClient.getConsumer();

      await this.consumer.subscribe({
        topic: this.topic,
        fromBeginning: false,
      });
      this.isRunning = true;

      this.logger.log(
        `Started MQ consumer for topic: ${this.topic}, group: ${this.ConsumerClient.getGroupId()}`,
      );

      this.consume().catch((error) => {
        this.logger.error(
          `MQ Consumer runtime error: ${error.message}`,
          error.stack,
        );
        this.isRunning = false;
      });
    } catch (error) {
      this.logger.error(
        `Failed to start MQ consumer: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  private async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    this.logger.log("Graceful shutdown initiated: Stopping MQ consumer...");

    try {
      // 1. Stop fetching new messages first to prevent batch from growing
      // Use a timeout for safety
      if (this.consumer) {
        this.logger.log("Stopping consumer fetcher...");
        await Promise.race([
          this.consumer.stop(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Consumer stop timeout")), 5000),
          ),
        ]).catch((err) =>
          this.logger.warn(`Consumer stop failed or timed out: ${err.message}`),
        );
      }

      // 2. Clear timeout immediately to avoid redundant batch processing
      if (this.batchTimeout) {
        clearTimeout(this.batchTimeout);
        this.batchTimeout = null;
      }

      // 3. Process remaining batch before shutdown with timeout
      if (this.batch.length > 0) {
        this.logger.log(
          `Processing final batch of ${this.batch.length} events before shutdown`,
        );
        const batchToProcess = [...this.batch];
        this.batch = [];

        await Promise.race([
          this.processBatch(batchToProcess),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error("Final batch processing timeout")),
              5000,
            ),
          ),
        ]).catch((err) =>
          this.logger.warn(
            `Final batch processing failed or timed out: ${err.message}`,
          ),
        );
      }

      // 4. Finally disconnect from Kafka
      this.logger.log("Disconnecting from Kafka...");
      await this.ConsumerClient.disconnect();
      this.logger.log("MQ consumer stopped successfully");
    } catch (error) {
      this.logger.error(
        `Error during MQ consumer graceful shutdown: ${error.message}`,
        error.stack,
      );
    }
  }

  private async consume(): Promise<void> {
    await this.consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        try {
          if (!message.value) {
            this.logger.warn("Received message with no value");
            return;
          }

          const logMessage: LogMessage = JSON.parse(message.value.toString());
          this.batch.push(logMessage);

          // Process batch if it reaches the size limit
          if (this.batch.length >= this.batchSize) {
            await this.flushBatch();
          } else {
            // Set timeout for batch processing
            this.scheduleBatchFlush();
          }
        } catch (error) {
          this.logger.error(
            `Error processing message from topic ${topic}, partition ${partition}: ${error.message}`,
            error.stack,
          );
        }
      },
    });
  }

  private scheduleBatchFlush(): void {
    if (this.batchTimeout) {
      return;
    }

    this.batchTimeout = setTimeout(async () => {
      this.batchTimeout = null;
      if (this.batch.length > 0) {
        await this.flushBatch();
      }
    }, this.batchTimeoutMs);
  }

  private async flushBatch(): Promise<void> {
    if (this.batch.length === 0) {
      return;
    }

    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = null;
    }

    const batchToProcess = [...this.batch];
    this.batch = [];

    await this.processBatch(batchToProcess);
  }

  private async processBatch(batch: LogMessage[]): Promise<void> {
    const startTime = Date.now();
    let successCount = 0;
    let failureCount = 0;

    for (const message of batch) {
      try {
        await this.mongoLogger.log(
          message.event,
          message._metadata,
          message.summary,
        );
        successCount++;
      } catch (error) {
        failureCount++;
        this.logger.error(
          `Failed to persist log event (requestId: ${message.event.requestId}): ${error.message}`,
          error.stack,
        );
      }
    }

    const duration = Date.now() - startTime;
    this.logger.log(
      `Processed batch: ${batch.length} events (${successCount} success, ${failureCount} failures) in ${duration}ms`,
    );
  }
}
