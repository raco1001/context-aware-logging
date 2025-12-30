import { Injectable, Logger } from '@nestjs/common';
import { LogStoragePort, Watermark } from '@embeddings/out-ports/index';
import { LogEmbeddingEntity } from '@embeddings/domain/index';
import { MongoEmbeddingConnection } from './db.connect';
import { EmbeddingStatus } from '@logging/value-objects/index';
import { QueryMetadata } from '@embeddings/dtos/index';

@Injectable()
export class MongoLogAdapter extends LogStoragePort {
  private readonly logger = new Logger(MongoLogAdapter.name);
  private readonly collectionName = 'wide_events';
  private readonly progressCollection = 'embedding_progress';
  private readonly embeddedCollection = 'wide_events_embedded';

  constructor(private readonly connection: MongoEmbeddingConnection) {
    super();
  }

  async getWatermark(source: string): Promise<Watermark | null> {
    try {
      const collection = this.connection.getCollection(this.progressCollection);
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

  async findLogsAfterWatermark(
    source: string,
    watermark: Watermark | null,
    limit: number,
  ): Promise<LogEmbeddingEntity[]> {
    try {
      const collection = this.connection.getCollection(source);

      const query: any = {
        _summary: { $exists: true, $ne: '' },
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

      return docs.map(
        (doc) =>
          new LogEmbeddingEntity(
            doc._id,
            doc.requestId,
            doc.timestamp,
            doc._summary,
            EmbeddingStatus.PENDING,
            doc.service,
            undefined,
            undefined,
          ),
      );
    } catch (error) {
      this.logger.error(
        `Failed to find logs after watermark: ${error.message}`,
      );
      return [];
    }
  }

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
      const embeddedColl = this.connection.getCollection(
        this.embeddedCollection,
      );
      const progressColl = this.connection.getCollection(
        this.progressCollection,
      );

      if (results.length > 0) {
        const insertDocs = results.map((r) => ({
          eventId: r.eventId,
          summary: r.summary,
          model: r.model,
          embedding: r.embedding,
          service: r.service,
          createdAt: r.timestamp || new Date(),
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

  async logFailure(requestId: string, reason: string): Promise<void> {
    this.logger.error(`Embedding failure for ${requestId}: ${reason}`);
  }

  async vectorSearch(
    embedding: number[],
    limit: number,
    metadata?: QueryMetadata,
  ): Promise<any[]> {
    try {
      const collection = this.connection.getCollection(this.embeddedCollection);

      const filter: any = {};
      if (metadata) {
        if (metadata.startTime || metadata.endTime) {
          filter.createdAt = {};
          if (metadata.startTime) filter.createdAt.$gte = metadata.startTime;
          if (metadata.endTime) filter.createdAt.$lte = metadata.endTime;
        }
        if (metadata.service) {
          filter.service = metadata.service;
        }
      }

      const vectorSearchStage: any = {
        index: 'embedding_index',
        path: 'embedding',
        queryVector: embedding,
        numCandidates: limit * 10,
        limit: limit,
      };

      if (Object.keys(filter).length > 0) {
        vectorSearchStage.filter = filter;
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
            score: { $meta: 'vectorSearchScore' },
          },
        },
      ];

      return await collection.aggregate(pipeline).toArray();
    } catch (error) {
      this.logger.error(`Embedding search failed: ${error.message}`);
      throw error;
    }
  }

  async getLogsByEventIds(eventIds: any[]): Promise<any[]> {
    try {
      const collection = this.connection.getCollection(this.collectionName);
      return await collection.find({ _id: { $in: eventIds } }).toArray();
    } catch (error) {
      this.logger.error(`Failed to get logs by event IDs: ${error.message}`);
      throw error;
    }
  }
}
