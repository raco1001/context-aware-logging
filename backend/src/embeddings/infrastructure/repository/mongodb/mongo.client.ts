import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongoClient, Db, Collection, Document } from 'mongodb';

/**
 * MongoEmbeddingClient - MongoDB connection for the embeddings module.
 */
@Injectable()
export class MongoEmbeddingClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MongoEmbeddingClient.name);
  private client: MongoClient;
  private db: Db;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    const uri =
      this.configService.get<string>('MONGODB_URI') ||
      'mongodb://eventsAdmin:eventsAdmin@localhost:27016/wide_events?authSource=wide_events&directConnection=true';
    if (!uri) {
      throw new Error('MONGODB_URI is not defined in environment variables');
    }

    try {
      this.client = new MongoClient(uri);
      await this.client.connect();
      this.db = this.client.db();
      this.logger.log(
        'Successfully connected to MongoDB for Embeddings module',
      );
    } catch (error) {
      this.logger.error(`Failed to connect to MongoDB: ${error.message}`);
      throw error;
    }
  }

  getCollection<T extends Document = any>(name: string): Collection<T> {
    if (!this.db) {
      throw new Error('Database connection not initialized');
    }
    return this.db.collection<T>(name);
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.close();
      this.logger.log('MongoDB connection for Embeddings module closed');
    }
  }
}
