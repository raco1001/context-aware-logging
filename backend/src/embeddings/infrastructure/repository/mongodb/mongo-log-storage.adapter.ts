import { Injectable, Logger } from "@nestjs/common";
import { LogStoragePort, Watermark } from "@embeddings/out-ports";
import { LogEmbeddingEntity } from "@embeddings/domain";
import { MongoEmbeddingClient } from "./mongo.client";
import { EmbeddingStatus } from "@logging/value-objects";
import { QueryMetadata } from "@embeddings/dtos";
import { WideEvent } from "@logging/domain";

/**
 * MongoLogStorageAdapter - Infrastructure layer implementation of LogStoragePort.
 * Persists embedding results to MongoDB and provides search capabilities.
 */
@Injectable()
export class MongoLogStorageAdapter extends LogStoragePort {
  private readonly logger = new Logger(MongoLogStorageAdapter.name);
  private readonly logsCollection = "wide_events";
  private readonly progressCollection = "embedding_progress";
  private readonly embeddedCollection = "wide_events_embedded";

  constructor(private readonly client: MongoEmbeddingClient) {
    super();
  }

  /**
   * Retrieves the last processed watermark for a given source.
   */
  async getWatermark(source: string): Promise<Watermark | null> {
    try {
      const collection = this.client.getCollection(this.progressCollection);
      const doc = await collection.findOne({ source });

      if (!doc) return null;

      return {
        lastEventId: doc.lastEmbeddedEventId,
        lastEventTimestamp: doc.lastEmbeddedEventTimestamp,
      };
    } catch (error) {
      this.logger.error(
        `Failed to get watermark for ${source}: ${error.message}`,
      );
      return null;
    }
  }

  /**
   * Retrieves logs that need embedding starting after the given watermark.
   */
  async findLogsAfterWatermark(
    source: string,
    watermark: Watermark | null,
    limit: number,
  ): Promise<LogEmbeddingEntity[]> {
    try {
      const collection = this.client.getCollection(source);

      const query: any = {
        _summary: { $exists: true, $ne: "" },
      };

      if (watermark) {
        query.$or = [
          { timestamp: { $gt: watermark.lastEventTimestamp } },
          {
            timestamp: watermark.lastEventTimestamp,
            _id: { $gt: watermark.lastEventId },
          },
        ];
      }

      const docs = await collection
        .find(query)
        .sort({ timestamp: 1, _id: 1 })
        .limit(limit)
        .toArray();

      return docs.map((doc) => {
        const wideEvent = WideEvent.fromDocument({
          requestId: doc.requestId,
          timestamp: doc.timestamp,
          service: doc.service,
          route: doc.route,
          user: doc.user,
          error: doc.error,
          performance: doc.performance,
        });

        return new LogEmbeddingEntity(
          doc._id,
          doc.requestId,
          doc.timestamp instanceof Date
            ? doc.timestamp
            : new Date(doc.timestamp),
          doc._summary,
          EmbeddingStatus.PENDING,
          doc.service,
          undefined,
          undefined,
          wideEvent,
        );
      });
    } catch (error) {
      this.logger.error(
        `Failed to find logs after watermark: ${error.message}`,
      );
      return [];
    }
  }

  /**
   * Saves embedding results to the destination collection and updates the watermark.
   */
  async saveEmbeddingsAndUpdateWatermark(
    source: string,
    results: Array<{
      eventId: any;
      requestId: string;
      summary: string;
      embedding: number[];
      model: string;
      service?: string;
      timestamp?: Date;
    }>,
    newWatermark: Watermark,
  ): Promise<void> {
    try {
      const embeddedColl = this.client.getCollection(this.embeddedCollection);
      const progressColl = this.client.getCollection(this.progressCollection);

      if (results.length > 0) {
        const insertDocs = results.map((r) => ({
          eventId: r.eventId,
          requestId: r.requestId,
          summary: r.summary,
          model: r.model,
          embedding: r.embedding,
          service: r.service,
          timestamp: r.timestamp || new Date(),
          createdAt: new Date(),
        }));
        await embeddedColl.insertMany(insertDocs);
      }

      await progressColl.updateOne(
        { source },
        {
          $set: {
            lastEmbeddedEventId: newWatermark.lastEventId,
            lastEmbeddedEventTimestamp: newWatermark.lastEventTimestamp,
            lastUpdatedAt: new Date(),
          },
        },
        { upsert: true },
      );

      this.logger.log(
        `Successfully saved ${results.length} embeddings and updated watermark for ${source}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to save embeddings and update watermark: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Logs a failure for a specific request.
   */
  async logFailure(requestId: string, reason: string): Promise<void> {
    this.logger.error(`Embedding failure for ${requestId}: ${reason}`);
  }

  /**
   * Performs semantic search using vector similarity with optional metadata filtering.
   */
  async vectorSearch(
    embedding: number[],
    limit: number,
    metadata?: QueryMetadata,
  ): Promise<any[]> {
    try {
      const collection = this.client.getCollection(this.embeddedCollection);

      const totalCount = await collection.countDocuments();
      this.logger.log(
        `Vector search: Collection "${this.embeddedCollection}" has ${totalCount} documents`,
      );

      if (totalCount === 0) {
        this.logger.warn(
          `No documents found in ${this.embeddedCollection}. Run embedding batch process first.`,
        );
        return [];
      }

      const filter: any = {};
      if (metadata) {
        if (metadata.startTime || metadata.endTime) {
          filter.timestamp = {};
          if (metadata.startTime) filter.timestamp.$gte = metadata.startTime;
          if (metadata.endTime) filter.timestamp.$lte = metadata.endTime;
        }
        if (metadata.service) {
          filter.service = metadata.service;
          this.logger.debug(`Applying service filter: "${metadata.service}"`);
        }
      }

      const vectorSearchStage: any = {
        index: "embedding_index",
        path: "embedding",
        queryVector: embedding,
        numCandidates: limit * 10,
        limit: limit,
      };

      if (Object.keys(filter).length > 0) {
        vectorSearchStage.filter = filter;
        this.logger.debug(`Vector search filter: ${JSON.stringify(filter)}`);
      } else {
        this.logger.debug("No filters applied to vector search");
      }

      const pipeline = [
        {
          $vectorSearch: vectorSearchStage,
        },
        {
          $project: {
            _id: 0,
            eventId: 1,
            summary: 1,
            score: { $meta: "vectorSearchScore" },
          },
        },
      ];

      let results: any[];
      try {
        results = await collection.aggregate(pipeline).toArray();
      } catch (error: any) {
        if (
          error.message?.includes("index") ||
          error.message?.includes("vectorSearch") ||
          error.message?.includes("SearchIndex")
        ) {
          this.logger.error(
            `Vector search failed: Search Index may not exist. Error: ${error.message}`,
          );
          this.logger.error(
            `Please create Search Index "embedding_index" on collection "${this.embeddedCollection}". See docs/mongodb-search-index-setup.md for instructions.`,
          );
          throw new Error(
            `Search Index "embedding_index" not found. Please create it first. See docs/mongodb-search-index-setup.md`,
          );
        }
        throw error;
      }

      this.logger.log(
        `Vector search completed: ${results.length} results (requested: ${limit})`,
      );

      if (results.length === 0 && filter.service) {
        this.logger.warn(
          `No results with service filter "${filter.service}". Trying without service filter...`,
        );
        const fallbackFilter = { ...filter };
        delete fallbackFilter.service;

        if (Object.keys(fallbackFilter).length > 0) {
          vectorSearchStage.filter = fallbackFilter;
        } else {
          delete vectorSearchStage.filter;
        }

        const fallbackResults = await collection.aggregate(pipeline).toArray();
        this.logger.log(
          `Fallback search (without service filter) returned ${fallbackResults.length} results`,
        );
        return fallbackResults;
      }

      return results;
    } catch (error) {
      this.logger.error(
        `Embedding search failed: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Retrieves full log documents by their internal IDs.
   */
  async getLogsByEventIds(eventIds: any[]): Promise<any[]> {
    try {
      const collection = this.client.getCollection(this.logsCollection);
      return await collection.find({ _id: { $in: eventIds } }).toArray();
    } catch (error) {
      this.logger.error(`Failed to get logs by event IDs: ${error.message}`);
      throw error;
    }
  }

  /**
   * Execute aggregation pipeline on a collection.
   * Used for statistical queries (e.g., error code counts, top N analysis).
   */
  async executeAggregation(
    pipeline: any[],
    collectionName: string = "wide_events",
  ): Promise<any[]> {
    try {
      const collection = this.client.getCollection(collectionName);
      this.logger.debug(
        `Executing aggregation pipeline on ${collectionName}: ${JSON.stringify(pipeline, null, 2)}`,
      );
      const results = await collection.aggregate(pipeline).toArray();
      this.logger.log(
        `Aggregation completed: ${results.length} results returned`,
      );
      return results;
    } catch (error) {
      this.logger.error(
        `Aggregation failed on ${collectionName}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Fetches full log documents by their request IDs.
   */
  async findLogsByRequestIds(requestIds: string[]): Promise<any[]> {
    try {
      const collection = this.client.getCollection(this.logsCollection);
      return await collection
        .find({ requestId: { $in: requestIds } })
        .toArray();
    } catch (error) {
      this.logger.error(`Failed to find logs by requestIds: ${error.message}`);
      throw error;
    }
  }
}
