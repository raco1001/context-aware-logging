import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { QueryMetadata } from "@embeddings/dtos";
import * as crypto from "crypto";

/**
 * Cached vector search result.
 */
interface CachedVectorResult {
  vectorResults: any[]; // Results from vectorSearch
  timestamp: Date;
  ttl: number; // Time-to-live in milliseconds
  embedding: number[]; // Original query embedding for similarity comparison
  metadata: QueryMetadata; // Original metadata for cache key generation
}

/**
 * Cache key based on normalized query and metadata hash.
 */
interface CacheKey {
  metadataHash: string; // Hash of normalized metadata
  embeddingHash: string; // Hash of normalized embedding (for quick lookup)
}

/**
 * SemanticCacheService - Caches vector search results based on semantic similarity.
 *
 * This service reduces API costs and latency by caching vector search results
 * for similar queries. It uses cosine similarity to determine cache hits.
 *
 * Phase 4: In-memory caching (single instance)
 * Phase 5: Can be extended to Redis for distributed environments
 */
@Injectable()
export class SemanticCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(SemanticCacheService.name);
  private readonly cache = new Map<string, CachedVectorResult>();
  private readonly defaultTtl = 60 * 60 * 1000; // 1 hour
  private readonly timeRangeTtl = 15 * 60 * 1000; // 15 minutes (for time-range queries)
  private readonly similarityThreshold = 0.95; // Cosine similarity threshold for cache hit
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Start periodic cleanup of expired entries
    this.startCleanupInterval();
  }

  /**
   * Retrieves cached vector results if a similar query exists.
   *
   * @param embedding Query embedding vector
   * @param metadata Query metadata
   * @returns Cached results if found and similar enough, null otherwise
   */
  getCachedResults(embedding: number[], metadata: QueryMetadata): any[] {
    const cacheKey = this.generateCacheKey(metadata);
    const candidates = this.findCandidatesByMetadata(cacheKey);

    if (candidates.length === 0) {
      this.logger.debug("No cache candidates found for metadata");
      return [];
    }

    // Find the most similar cached entry
    let bestMatch: { entry: CachedVectorResult; similarity: number } | null =
      null;

    for (const entry of candidates) {
      if (this.isExpired(entry)) {
        continue;
      }

      const similarity = this.cosineSimilarity(embedding, entry.embedding);
      if (
        similarity >= this.similarityThreshold &&
        (!bestMatch || similarity > bestMatch.similarity)
      ) {
        bestMatch = { entry, similarity };
      }
    }

    if (bestMatch) {
      this.logger.log(
        `Cache hit! Similarity: ${bestMatch.similarity.toFixed(4)} (threshold: ${this.similarityThreshold})`,
      );
      return bestMatch.entry.vectorResults;
    }

    // Log best similarity found (if any candidates existed)
    const bestSimilarity =
      candidates.length > 0
        ? Math.max(
            ...candidates.map((entry) =>
              this.cosineSimilarity(embedding, entry.embedding),
            ),
          )
        : 0;
    this.logger.debug(
      `Cache miss. Best similarity: ${bestSimilarity.toFixed(4)} (threshold: ${this.similarityThreshold})`,
    );
    return [];
  }

  /**
   * Stores vector search results in cache.
   *
   * @param embedding Query embedding vector
   * @param metadata Query metadata
   * @param vectorResults Vector search results to cache
   */
  setCachedResults(
    embedding: number[],
    metadata: QueryMetadata,
    vectorResults: any[],
  ): void {
    const cacheKey = this.generateCacheKey(metadata);
    const ttl = this.calculateTtl(metadata);

    // Use metadata hash as the primary cache key
    const key = cacheKey.metadataHash;

    this.cache.set(key, {
      vectorResults,
      timestamp: new Date(),
      ttl,
      embedding,
      metadata,
    });

    this.logger.log(
      `Cached vector results (key: ${key.substring(0, 8)}..., ttl: ${ttl / 1000 / 60}min, results: ${vectorResults.length})`,
    );
  }

  /**
   * Invalidates cache entries matching the metadata.
   *
   * @param metadata Metadata to invalidate
   */
  invalidateCache(metadata: QueryMetadata): void {
    const cacheKey = this.generateCacheKey(metadata);
    const key = cacheKey.metadataHash;

    if (this.cache.delete(key)) {
      this.logger.log(`Invalidated cache entry: ${key.substring(0, 8)}...`);
    }
  }

  /**
   * Clears all cache entries.
   */
  clearCache(): void {
    const size = this.cache.size;
    this.cache.clear();
    this.logger.log(`Cleared all cache entries (${size} entries)`);
  }

  /**
   * Generates a cache key from metadata.
   * Normalizes metadata to ensure consistent hashing.
   */
  private generateCacheKey(metadata: QueryMetadata): CacheKey {
    // Normalize metadata for consistent hashing
    const normalized = {
      service: metadata.service || null,
      route: metadata.route || null,
      errorCode: metadata.errorCode || null,
      hasError: metadata.hasError || false,
      // Time range is normalized to hour precision for better cache hits
      startTime: metadata.startTime
        ? this.normalizeTimeToHour(metadata.startTime)
        : null,
      endTime: metadata.endTime
        ? this.normalizeTimeToHour(metadata.endTime)
        : null,
    };

    const metadataJson = JSON.stringify(normalized);
    const metadataHash = crypto
      .createHash("sha256")
      .update(metadataJson)
      .digest("hex");

    // For quick embedding lookup, create a hash of normalized embedding
    // (we'll use the first few dimensions for quick comparison)
    const embeddingHash = ""; // Not used in current implementation

    return { metadataHash, embeddingHash };
  }

  /**
   * Normalizes time to hour precision for better cache hits.
   */
  private normalizeTimeToHour(date: Date): string {
    const normalized = new Date(date);
    normalized.setMinutes(0);
    normalized.setSeconds(0);
    normalized.setMilliseconds(0);
    return normalized.toISOString();
  }

  /**
   * Finds cache candidates that match the metadata key.
   */
  private findCandidatesByMetadata(cacheKey: CacheKey): CachedVectorResult[] {
    const candidates: CachedVectorResult[] = [];
    const key = cacheKey.metadataHash;

    // Check exact match first
    const exactMatch = this.cache.get(key);
    if (exactMatch && !this.isExpired(exactMatch)) {
      candidates.push(exactMatch);
    }

    // Also check entries with similar metadata (same service/route but different time)
    // This allows for better cache hits when time ranges are slightly different
    for (const [entryKey, entry] of this.cache.entries()) {
      if (entryKey === key) continue; // Already added

      if (
        this.metadataMatches(entry.metadata, cacheKey) &&
        !this.isExpired(entry)
      ) {
        candidates.push(entry);
      }
    }

    return candidates;
  }

  /**
   * Checks if metadata matches the cache key (ignoring time differences within same hour).
   */
  private metadataMatches(
    entryMetadata: QueryMetadata,
    cacheKey: CacheKey,
  ): boolean {
    // This is a simplified check - in practice, we'd compare the normalized metadata
    // For now, we rely on the exact hash match and similarity-based matching
    return false; // Disabled for now, rely on exact hash + similarity
  }

  /**
   * Calculates cosine similarity between two vectors.
   */
  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) {
      return 0;
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Calculates TTL based on metadata.
   * Shorter TTL for time-range queries to reflect data changes.
   */
  private calculateTtl(metadata: QueryMetadata): number {
    // If query has time range, use shorter TTL
    if (metadata.startTime || metadata.endTime) {
      return this.timeRangeTtl;
    }
    return this.defaultTtl;
  }

  /**
   * Checks if a cached entry has expired.
   */
  private isExpired(cached: CachedVectorResult): boolean {
    const now = new Date();
    const elapsed = now.getTime() - cached.timestamp.getTime();
    return elapsed > cached.ttl;
  }

  /**
   * Starts periodic cleanup of expired entries.
   */
  private startCleanupInterval(): void {
    // Cleanup every 10 minutes
    this.cleanupInterval = setInterval(
      () => {
        this.cleanupExpiredEntries();
      },
      10 * 60 * 1000,
    );
  }

  /**
   * Removes expired entries from cache.
   */
  private cleanupExpiredEntries(): void {
    const now = new Date();
    let removedCount = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (this.isExpired(entry)) {
        this.cache.delete(key);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      this.logger.log(
        `Cleaned up ${removedCount} expired cache entries. Active entries: ${this.cache.size}`,
      );
    }
  }

  /**
   * Gets statistics about the cache.
   */
  getCacheStats(): {
    totalEntries: number;
    expiredEntries: number;
    activeEntries: number;
  } {
    let expiredCount = 0;
    for (const entry of this.cache.values()) {
      if (this.isExpired(entry)) {
        expiredCount++;
      }
    }

    return {
      totalEntries: this.cache.size,
      expiredEntries: expiredCount,
      activeEntries: this.cache.size - expiredCount,
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
    this.logger.log("SemanticCacheService destroyed");
  }
}
