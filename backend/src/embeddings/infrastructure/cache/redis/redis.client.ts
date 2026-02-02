import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';

/**
 * RedisClient - Infrastructure client for Redis connection management.
 *
 * This class is responsible solely for:
 * - Redis connection initialization
 * - Connection lifecycle management (connect/disconnect)
 * - Providing the client instance to adapters
 *
 * Actual cache operations are delegated to adapters that use this client instance.
 *
 * Only initializes connection when SESSION_CACHE_TYPE=redis.
 *
 * Phase 5: Redis client for distributed caching
 */
@Injectable()
export class RedisClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisClient.name);
  private client: RedisClientType | null = null;
  private enabled = false;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const cacheType =
      this.configService.get<string>('SESSION_CACHE_TYPE') || 'memory';

    if (cacheType !== 'redis') {
      this.logger.log('Redis client skipped (SESSION_CACHE_TYPE is not redis)');
      return;
    }

    this.enabled = true;
    const host = this.configService.get<string>('REDIS_HOST') || 'localhost';
    const port = this.configService.get<number>('REDIS_PORT') || 6379;
    const url = `redis://${host}:${port}`;

    this.client = createClient({ url });

    this.client.on('error', (err) => {
      this.logger.error(`Redis client error: ${err.message}`);
    });

    this.client.on('connect', () => {
      this.logger.log(`Redis client connected to ${host}:${port}`);
    });

    this.client.on('reconnecting', () => {
      this.logger.warn('Redis client reconnecting...');
    });

    try {
      await this.client.connect();
      this.logger.log('Successfully connected to Redis for Embeddings module');
    } catch (error) {
      this.logger.error(`Failed to connect to Redis: ${error.message}`);
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.logger.log('Redis connection for Embeddings module closed');
    }
  }

  /**
   * Returns the initialized Redis client instance.
   * This is the single source of truth for the Redis client.
   */
  getClient(): RedisClientType {
    if (!this.client) {
      throw new Error('Redis client not initialized');
    }
    return this.client;
  }

  /**
   * Checks if the Redis client is connected and ready.
   */
  isReady(): boolean {
    return this.client?.isReady ?? false;
  }

  /**
   * Checks if Redis is enabled based on configuration.
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}
