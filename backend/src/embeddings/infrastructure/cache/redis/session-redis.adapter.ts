import { Injectable, Logger } from "@nestjs/common";
import { SessionCachePort } from "@embeddings/out-ports";
import { SessionCacheDto } from "@embeddings/dtos";
import { RedisClient } from "./redis.client";

/**
 * Serializable version of SessionCacheDto for Redis storage.
 * Date objects are converted to ISO strings.
 */
interface SerializedSessionCacheDto {
  history: any[];
  lastAccessed: string; // ISO string
  ttl: number;
}

/**
 * SessionRedisAdapter - Redis implementation of SessionCachePort.
 *
 * Uses Redis for distributed session cache storage.
 * Suitable for multi-instance deployments.
 *
 * Connection management is delegated to RedisClient.
 * This adapter focuses solely on cache operations.
 *
 * Phase 5: Redis caching for distributed environments
 */
@Injectable()
export class SessionRedisAdapter extends SessionCachePort {
  private readonly logger = new Logger(SessionRedisAdapter.name);
  private readonly keyPrefix = "session:";

  constructor(private readonly redisClient: RedisClient) {
    super();
  }

  /**
   * Returns the Redis client instance from RedisClient.
   */
  private get client() {
    return this.redisClient.getClient();
  }

  async get(sessionId: string): Promise<SessionCacheDto | null> {
    try {
      const data = await this.client.get(this.keyPrefix + sessionId);
      if (!data) return null;

      const parsed: SerializedSessionCacheDto = JSON.parse(data);
      return this.deserialize(parsed);
    } catch (error) {
      this.logger.error(`Failed to get session ${sessionId}: ${error.message}`);
      return null;
    }
  }

  async set(sessionId: string, data: SessionCacheDto): Promise<void> {
    try {
      const serialized = this.serialize(data);
      const ttlSeconds = Math.floor(data.ttl / 1000);

      await this.client.setEx(
        this.keyPrefix + sessionId,
        ttlSeconds,
        JSON.stringify(serialized),
      );
    } catch (error) {
      this.logger.error(`Failed to set session ${sessionId}: ${error.message}`);
      throw error;
    }
  }

  async delete(sessionId: string): Promise<boolean> {
    try {
      const result = await this.client.del(this.keyPrefix + sessionId);
      return result > 0;
    } catch (error) {
      this.logger.error(
        `Failed to delete session ${sessionId}: ${error.message}`,
      );
      return false;
    }
  }

  async entries(): Promise<[string, SessionCacheDto][]> {
    try {
      const keys = await this.scanKeys();
      const entries: [string, SessionCacheDto][] = [];

      for (const key of keys) {
        const sessionId = key.replace(this.keyPrefix, "");
        const data = await this.get(sessionId);
        if (data) {
          entries.push([sessionId, data]);
        }
      }

      return entries;
    } catch (error) {
      this.logger.error(`Failed to get entries: ${error.message}`);
      return [];
    }
  }

  async values(): Promise<SessionCacheDto[]> {
    const entries = await this.entries();
    return entries.map(([, value]) => value);
  }

  async size(): Promise<number> {
    try {
      const keys = await this.scanKeys();
      return keys.length;
    } catch (error) {
      this.logger.error(`Failed to get size: ${error.message}`);
      return 0;
    }
  }

  /**
   * Redis handles TTL-based expiration automatically.
   * This method is provided for interface compliance.
   * @returns 0 (Redis handles expiration automatically)
   */
  async cleanupExpiredSessions(): Promise<number> {
    // Redis TTL automatically handles expiration
    // No manual cleanup needed
    this.logger.debug("Redis handles TTL-based expiration automatically");
    return 0;
  }

  /**
   * Scans all session keys using Redis SCAN command.
   * More efficient than KEYS for large datasets.
   */
  private async scanKeys(): Promise<string[]> {
    const keys: string[] = [];
    let cursor = "0";

    do {
      const result = await this.client.scan(cursor, {
        MATCH: this.keyPrefix + "*",
        COUNT: 100,
      });
      cursor = String(result.cursor);
      keys.push(...result.keys);
    } while (cursor !== "0");

    return keys;
  }

  /**
   * Serializes SessionCacheDto for Redis storage.
   * Converts Date objects to ISO strings.
   */
  private serialize(data: SessionCacheDto): SerializedSessionCacheDto {
    return {
      history: data.history,
      lastAccessed: data.lastAccessed.toISOString(),
      ttl: data.ttl,
    };
  }

  /**
   * Deserializes Redis data to SessionCacheDto.
   * Converts ISO strings back to Date objects.
   */
  private deserialize(data: SerializedSessionCacheDto): SessionCacheDto {
    return {
      history: data.history,
      lastAccessed: new Date(data.lastAccessed),
      ttl: data.ttl,
    };
  }
}
