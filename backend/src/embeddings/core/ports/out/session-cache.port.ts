import { SessionCacheDto } from "@embeddings/dtos";

/**
 * Outbound port for session cache storage.
 *
 * Provides a unified interface for caching session history data.
 * Implementations can be in-memory (single instance) or Redis (distributed).
 */
export abstract class SessionCachePort {
  /**
   * Retrieves cached session data by session ID.
   * @param sessionId Session identifier
   * @returns Cached session data or null if not found
   */
  abstract get(sessionId: string): Promise<SessionCacheDto | null>;

  /**
   * Stores or updates session data in cache.
   * @param sessionId Session identifier
   * @param data Session cache data to store
   */
  abstract set(sessionId: string, data: SessionCacheDto): Promise<void>;

  /**
   * Removes a session from cache.
   * @param sessionId Session identifier to remove
   * @returns true if session was removed, false if not found
   */
  abstract delete(sessionId: string): Promise<boolean>;

  /**
   * Returns all cached sessions as key-value pairs.
   * @returns Array of [sessionId, SessionCacheDto] tuples
   */
  abstract entries(): Promise<[string, SessionCacheDto][]>;

  /**
   * Returns all cached session values.
   * @returns Array of SessionCacheDto objects
   */
  abstract values(): Promise<SessionCacheDto[]>;

  /**
   * Returns the number of cached sessions.
   * @returns Number of cached sessions
   */
  abstract size(): Promise<number>;

  /**
   * Cleans up expired sessions based on TTL.
   * Implementation decides how to check expiration and perform cleanup.
   * @returns Number of expired sessions that were removed
   */
  abstract cleanupExpiredSessions(): Promise<number>;
}
