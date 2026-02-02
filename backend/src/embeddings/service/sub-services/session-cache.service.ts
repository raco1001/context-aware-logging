import { Injectable, Logger } from '@nestjs/common';
import { ChatHistoryPort, SessionCachePort } from '@embeddings/out-ports';
import { SessionCacheDto, AnalysisResult } from '@embeddings/dtos';

/**
 * SessionCacheService - Manages active session history with TTL.
 *
 * This service provides fast access to session history for active conversations
 * while falling back to database for inactive sessions.
 *
 * Phase 4: In-memory caching (single instance)
 * Phase 5: Can be extended to Redis for distributed environments
 *
 * Note: Resource management (cleanup intervals, cache clearing) is handled by
 * the SessionCachePort adapter implementation.
 */
@Injectable()
export class SessionCacheService {
  private readonly logger = new Logger(SessionCacheService.name);
  private readonly defaultTtl = 30 * 60 * 1000; // 30 minutes

  constructor(
    private readonly chatHistoryPort: ChatHistoryPort,
    private readonly sessionCachePort: SessionCachePort,
  ) {}

  /**
   * Retrieves session history with cache-first strategy.
   * Falls back to database if cache miss or expired.
   *
   * @param sessionId Session ID
   * @returns Session history
   */
  async getHistory(sessionId: string): Promise<AnalysisResult[]> {
    const cached = await this.sessionCachePort.get(sessionId);
    if (cached && !this.isExpired(cached)) {
      cached.lastAccessed = new Date();
      await this.sessionCachePort.set(sessionId, cached);
      this.logger.debug(
        `Cache hit for session ${sessionId} (${cached.history.length} messages)`,
      );
      return cached.history;
    }

    this.logger.debug(`Cache miss for session ${sessionId}, fetching from DB`);
    const history = await this.chatHistoryPort.findBySessionId(sessionId);

    if (history.length > 0) {
      await this.sessionCachePort.set(sessionId, {
        history,
        lastAccessed: new Date(),
        ttl: this.defaultTtl,
      });
      this.logger.debug(
        `Cached session ${sessionId} with ${history.length} messages`,
      );
    }

    return history;
  }

  /**
   * Updates session cache and persists to database.
   *
   * @param sessionId Session ID
   * @param result New analysis result to add
   */
  async updateSession(
    sessionId: string,
    result: AnalysisResult,
  ): Promise<void> {
    await this.chatHistoryPort.save(result);

    const cached = await this.sessionCachePort.get(sessionId);
    if (cached) {
      cached.history.push(result);
      cached.lastAccessed = new Date();
      await this.sessionCachePort.set(sessionId, cached);
      this.logger.debug(
        `Updated cache for session ${sessionId} (now ${cached.history.length} messages)`,
      );
    } else {
      await this.sessionCachePort.set(sessionId, {
        history: [result],
        lastAccessed: new Date(),
        ttl: this.defaultTtl,
      });
      this.logger.debug(`Created new cache entry for session ${sessionId}`);
    }
  }

  /**
   * Invalidates a session from cache (forces next fetch from DB).
   *
   * @param sessionId Session ID to invalidate
   */
  async invalidateSession(sessionId: string): Promise<void> {
    const deleted = await this.sessionCachePort.delete(sessionId);
    if (deleted) {
      this.logger.debug(`Invalidated cache for session ${sessionId}`);
    }
  }

  /**
   * Checks if a cached session has expired.
   */
  private isExpired(cached: SessionCacheDto): boolean {
    const now = new Date();
    const elapsed = now.getTime() - cached.lastAccessed.getTime();
    return elapsed > cached.ttl;
  }

  /**
   * Gets statistics about the cache.
   */
  async getCacheStats(): Promise<{
    activeSessions: number;
    totalMessages: number;
  }> {
    const values = await this.sessionCachePort.values();
    const totalMessages = values.reduce(
      (sum, session) => sum + session.history.length,
      0,
    );
    const activeSessions = await this.sessionCachePort.size();

    return {
      activeSessions,
      totalMessages,
    };
  }
}
