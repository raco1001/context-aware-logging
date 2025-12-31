import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ChatHistoryPort } from "@embeddings/out-ports";
import { AnalysisResult } from "@embeddings/domain";

/**
 * Session data stored in memory cache.
 */
interface CachedSession {
  history: AnalysisResult[];
  lastAccessed: Date;
  ttl: number; // Time-to-live in milliseconds
}

/**
 * SessionCacheService - Manages active session history in memory with TTL.
 *
 * This service provides fast access to session history for active conversations
 * while falling back to database for inactive sessions.
 *
 * Phase 4: In-memory caching (single instance)
 * Phase 5: Can be extended to Redis for distributed environments
 */
@Injectable()
export class SessionCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(SessionCacheService.name);
  private readonly activeSessions = new Map<string, CachedSession>();
  private readonly defaultTtl = 30 * 60 * 1000; // 30 minutes
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(private readonly chatHistoryPort: ChatHistoryPort) {
    // Start periodic cleanup of expired sessions
    this.startCleanupInterval();
  }

  /**
   * Retrieves session history with cache-first strategy.
   * Falls back to database if cache miss or expired.
   *
   * @param sessionId Session ID
   * @returns Session history
   */
  async getHistory(sessionId: string): Promise<AnalysisResult[]> {
    // 1. Check cache first
    const cached = this.activeSessions.get(sessionId);
    if (cached && !this.isExpired(cached)) {
      // Update last accessed time
      cached.lastAccessed = new Date();
      this.logger.debug(
        `Cache hit for session ${sessionId} (${cached.history.length} messages)`,
      );
      return cached.history;
    }

    // 2. Cache miss or expired → fetch from database
    this.logger.debug(`Cache miss for session ${sessionId}, fetching from DB`);
    const history = await this.chatHistoryPort.findBySessionId(sessionId);

    // 3. If session has history, cache it
    if (history.length > 0) {
      this.activeSessions.set(sessionId, {
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
    // 1. Persist to database
    await this.chatHistoryPort.save(result);

    // 2. Update cache if exists
    const cached = this.activeSessions.get(sessionId);
    if (cached) {
      cached.history.push(result);
      cached.lastAccessed = new Date();
      this.logger.debug(
        `Updated cache for session ${sessionId} (now ${cached.history.length} messages)`,
      );
    } else {
      // 3. If not cached, cache the new result
      this.activeSessions.set(sessionId, {
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
  invalidateSession(sessionId: string): void {
    if (this.activeSessions.delete(sessionId)) {
      this.logger.debug(`Invalidated cache for session ${sessionId}`);
    }
  }

  /**
   * Checks if a cached session has expired.
   */
  private isExpired(cached: CachedSession): boolean {
    const now = new Date();
    const elapsed = now.getTime() - cached.lastAccessed.getTime();
    return elapsed > cached.ttl;
  }

  /**
   * Starts periodic cleanup of expired sessions.
   */
  private startCleanupInterval(): void {
    // Cleanup every 5 minutes
    this.cleanupInterval = setInterval(
      () => {
        this.cleanupExpiredSessions();
      },
      5 * 60 * 1000,
    );
  }

  /**
   * Removes expired sessions from cache.
   */
  private cleanupExpiredSessions(): void {
    const now = new Date();
    let removedCount = 0;

    for (const [sessionId, session] of this.activeSessions.entries()) {
      if (this.isExpired(session)) {
        this.activeSessions.delete(sessionId);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      this.logger.log(
        `Cleaned up ${removedCount} expired sessions. Active sessions: ${this.activeSessions.size}`,
      );
    }
  }

  /**
   * Gets statistics about the cache.
   */
  getCacheStats(): {
    activeSessions: number;
    totalMessages: number;
  } {
    const totalMessages = Array.from(this.activeSessions.values()).reduce(
      (sum, session) => sum + session.history.length,
      0,
    );

    return {
      activeSessions: this.activeSessions.size,
      totalMessages,
    };
  }

  /**
   * Cleanup on module destroy.
   */
  onModuleDestroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.logger.log("SessionCacheService destroyed");
  }
}
