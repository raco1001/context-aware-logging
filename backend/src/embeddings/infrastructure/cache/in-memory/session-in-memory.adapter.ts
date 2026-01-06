import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { SessionCachePort } from "@embeddings/out-ports";
import { SessionCacheDto } from "@embeddings/dtos";

/**
 * InMemoryAdapter - In-memory implementation of SessionCachePort.
 *
 * Uses a Map to store session cache data in memory.
 * Suitable for single-instance deployments.
 *
 * Phase 4: In-memory caching (single instance)
 * Phase 5: Can be replaced with RedisAdapter for distributed environments
 */
@Injectable()
export class SessionInMemoryAdapter
  extends SessionCachePort
  implements OnModuleDestroy
{
  private readonly logger = new Logger(SessionInMemoryAdapter.name);
  private readonly cache = new Map<string, SessionCacheDto>();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly cleanupIntervalMs = 5 * 60 * 1000;

  constructor() {
    super();
    this.startCleanupInterval();
  }

  async get(sessionId: string): Promise<SessionCacheDto | null> {
    return this.cache.get(sessionId) || null;
  }

  async set(sessionId: string, data: SessionCacheDto): Promise<void> {
    this.cache.set(sessionId, data);
  }

  async delete(sessionId: string): Promise<boolean> {
    return this.cache.delete(sessionId);
  }

  async entries(): Promise<[string, SessionCacheDto][]> {
    return Array.from(this.cache.entries());
  }

  async values(): Promise<SessionCacheDto[]> {
    return Array.from(this.cache.values());
  }

  async size(): Promise<number> {
    return this.cache.size;
  }

  /**
   * Cleans up expired sessions based on TTL.
   * @returns Number of expired sessions that were removed
   */
  async cleanupExpiredSessions(): Promise<number> {
    const now = new Date();
    let removedCount = 0;

    for (const [sessionId, session] of this.cache.entries()) {
      const elapsed = now.getTime() - session.lastAccessed.getTime();
      if (elapsed > session.ttl) {
        this.cache.delete(sessionId);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      const activeSessions = this.cache.size;
      this.logger.log(
        `Cleaned up ${removedCount} expired sessions. Active sessions: ${activeSessions}`,
      );
    }

    return removedCount;
  }

  /**
   * Starts periodic cleanup of expired sessions.
   */
  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredSessions().catch((error) => {
        this.logger.error(
          `Error during cleanup: ${error.message}`,
          error.stack,
        );
      });
    }, this.cleanupIntervalMs);
  }

  /**
   * Cleanup on module destroy.
   */
  onModuleDestroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.cache.clear();
    this.logger.log("SessionInMemoryAdapter destroyed");
  }
}
