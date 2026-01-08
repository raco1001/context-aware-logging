import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { MongoClient, Db, Collection, Document } from "mongodb";

/**
 * MongoConnectionClient - Infrastructure wrapper for MongoDB connection.
 * Manages the lifecycle of the database connection.
 */
@Injectable()
export class MongoConnectionClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MongoConnectionClient.name);
  private client: MongoClient;
  private db: Db;
  private readonly uri: string;
  private readonly dbName: string;

  constructor(private readonly configService: ConfigService) {
    this.uri =
      this.configService.get<string>("MONGODB_URI") ||
      "mongodb://eventsAdmin:eventsAdmin@localhost:27016/wide_events?authSource=wide_events&directConnection=true";
    this.dbName = "wide_events";
  }

  async onModuleInit() {
    try {
      this.client = new MongoClient(this.uri);
      await this.client.connect();
      this.db = this.client.db(this.dbName);
      this.logger.log(`Successfully connected to MongoDB: ${this.dbName}`);
    } catch (error) {
      this.logger.error(`Failed to connect to MongoDB: ${error.message}`);
      // Future:Retry or handle this more gracefully.
      throw error;
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.close();
      this.logger.log("MongoDB connection closed.");
    }
  }

  /**
   * Provides access to a specific collection.
   * Ensuring the DB is initialized before access.
   */
  getCollection<T extends Document = any>(name: string): Collection<T> {
    if (!this.db) {
      throw new Error(
        "MongoDB client not initialized. Call onModuleInit first.",
      );
    }
    return this.db.collection<T>(name);
  }
}
