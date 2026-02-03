import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerPort } from '@logging/out-ports';
import { WideEvent } from '@logging/domain';
import { MongoConnectionClient } from './mongo.client';
import { LoggingContext } from '@logging/domain';
import { Document } from 'mongodb';

/**
 * MongoLogger - Infrastructure layer implementation of LoggerPort.
 * Persists Wide Events to a MongoDB Time-series collection.
 *
 * Performance Optimization:
 * - Batches multiple log entries before writing to reduce I/O overhead
 * - Configurable batch size and flush interval
 * - Automatic flush on module destroy to prevent data loss
 */
@Injectable()
export class MongoLogger extends LoggerPort implements OnModuleDestroy {
  private readonly internalLogger = new Logger(MongoLogger.name);
  private readonly collectionName = 'wide_events';

  // Batch write configuration
  private readonly buffer: Document[] = [];
  private readonly batchSize: number;
  private readonly flushIntervalMs: number;
  private flushTimer: NodeJS.Timeout | null = null;
  private isFlushing = false;

  constructor(
    private readonly mongoConnectionClient: MongoConnectionClient,
    private readonly configService: ConfigService,
  ) {
    super();

    // Configurable via environment variables
    this.batchSize = this.configService.get<number>('LOG_BATCH_SIZE', 50);
    this.flushIntervalMs = this.configService.get<number>(
      'LOG_FLUSH_INTERVAL_MS',
      1000,
    );

    // Start periodic flush timer
    this.startFlushTimer();
  }

  /**
   * Log a Wide Event to MongoDB with batching.
   * Events are buffered and written in batches to reduce I/O overhead.
   */
  async log(
    event: WideEvent,
    _metadata: LoggingContext['_metadata'] | undefined,
    _summary: string,
  ): Promise<void> {
    const document = {
      ...event,
      timestamp: new Date(event.timestamp),
      _metadata: _metadata,
      _summary: _summary,
    };

    this.buffer.push(document);

    // Flush immediately if buffer reaches batch size
    if (this.buffer.length >= this.batchSize) {
      await this.flush();
    }
  }

  /**
   * Flush buffered events to MongoDB.
   * Uses insertMany with ordered: false for better performance.
   */
  private async flush(): Promise<void> {
    if (this.buffer.length === 0 || this.isFlushing) {
      return;
    }

    this.isFlushing = true;

    // Take all buffered documents
    const toWrite = this.buffer.splice(0, this.buffer.length);

    try {
      await this.mongoConnectionClient
        .getCollection(this.collectionName)
        .insertMany(toWrite, {
          ordered: false, // Continue on error, don't stop at first failure
        });
    } catch (error: any) {
      // Log error but don't throw - logging should not break the application
      this.internalLogger.error(
        `Failed to persist ${toWrite.length} logs to MongoDB: ${error.message}`,
      );

      // Optionally: Could implement retry logic or dead-letter queue here
    } finally {
      this.isFlushing = false;
    }
  }

  /**
   * Start periodic flush timer.
   */
  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      this.flush().catch((err) => {
        this.internalLogger.error(`Periodic flush failed: ${err.message}`);
      });
    }, this.flushIntervalMs);
  }

  /**
   * Cleanup on module destroy - flush remaining buffer.
   */
  async onModuleDestroy(): Promise<void> {
    // Stop the timer
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // Flush remaining buffer
    if (this.buffer.length > 0) {
      this.internalLogger.log(
        `Flushing ${this.buffer.length} remaining log entries...`,
      );
      await this.flush();
    }
  }

  /**
   * Get current buffer stats for monitoring.
   */
  getBufferStats(): { bufferSize: number; batchSize: number } {
    return {
      bufferSize: this.buffer.length,
      batchSize: this.batchSize,
    };
  }
}
