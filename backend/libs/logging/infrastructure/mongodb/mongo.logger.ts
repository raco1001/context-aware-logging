import { Injectable, Logger } from "@nestjs/common";
import { LoggerPort } from "@logging/out-ports";
import { WideEvent } from "@logging/domain";
import { MongoConnectionClient } from "./mongo.client";
import { LoggingContext } from "@logging/domain";

/**
 * MongoLogger - Infrastructure layer implementation of LoggerPort.
 * Persists Wide Events to a MongoDB Time-series collection.
 */
@Injectable()
export class MongoLogger extends LoggerPort {
  private readonly internalLogger = new Logger(MongoLogger.name);
  private readonly collectionName = "wide_events";

  constructor(private readonly mongoConnectionClient: MongoConnectionClient) {
    super();
  }

  /**
   * Log a Wide Event to MongoDB.
   * Converts timestamp string to Date object for Time-series optimization.
   */
  async log(
    event: WideEvent,
    _metadata: LoggingContext["_metadata"] | undefined,
    _summary: string,
  ): Promise<void> {
    try {
      const document = {
        ...event,
        timestamp: new Date(event.timestamp),
        _summary: _summary,
      };

      await this.mongoConnectionClient
        .getCollection(this.collectionName)
        .insertOne(document);
    } catch (error) {
      this.internalLogger.error(
        `Failed to persist log to MongoDB: ${error.message}`,
      );
    }
  }
}
