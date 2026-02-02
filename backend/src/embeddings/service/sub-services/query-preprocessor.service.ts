import { Injectable, Logger } from '@nestjs/common';
import { QueryMetadata } from '@embeddings/dtos';
import {
  USER_ROLES_KEYWORDS,
  OUTCOME_KEYWORDS,
  LATENCY_KEYWORDS,
} from '@embeddings/value-objects/filter';
import {
  ROUTE_PATTERN_CONSTANTS,
  SERVICE_MAP_CONSTANTS,
} from '@embeddings/value-objects/constants';
/**
 * QueryPreprocessor - Transforms natural language queries into structured format
 * that matches the _summary format used for log embeddings.
 *
 * This improves semantic matching by ensuring queries and documents use
 * similar structured representations in the embedding space.
 *
 * Based on MongoDB RAG tutorial Step 3: Chunk and Embed strategy.
 */
@Injectable()
export class QueryPreprocessorService {
  private readonly logger = new Logger(QueryPreprocessorService.name);

  /**
   * Preprocesses a natural language query into a structured format
   * that matches the _summary format used for log embeddings.
   *
   * @param query The original natural language query
   * @param metadata Extracted metadata from the query (service, error, time range, etc.)
   * @returns A structured query string that matches the _summary format
   *
   * @example
   * Input: "are there any failed cases of the service 'payment' today?"
   * Output: "Outcome: FAILED, Service: payments, Error: ANY, ErrorMessage: ANY, UserRole: ANY, LatencyBucket: ANY"
   */
  preprocessQuery(query: string, metadata: QueryMetadata): string {
    this.logger.debug(
      `Preprocessing query: "${query}" with metadata: ${JSON.stringify(metadata)}`,
    );

    const parts: string[] = [];

    const outcome = this.determineOutcome(query, metadata);
    if (outcome !== 'ANY') {
      parts.push(`Outcome: ${outcome}`);
    }

    const service = this.normalizeService(metadata.service);
    if (service) {
      parts.push(`Service: ${service}`);
    }

    const route = this.extractRoute(query, metadata);
    if (route) {
      parts.push(`Route: ${route}`);
    }

    if (metadata.hasError || metadata.errorCode) {
      parts.push(`Error: ${metadata.errorCode || 'ANY'}`);
      parts.push(`ErrorMessage: ANY`);
    }

    const userRole = this.extractUserRole(query);
    if (userRole) {
      parts.push(`UserRole: ${userRole}`);
    }

    const latencyBucket = this.extractLatencyBucket(query);
    if (latencyBucket) {
      parts.push(`LatencyBucket: ${latencyBucket}`);
    }

    const structuredQuery = query.trim().concat(`\n\n${parts.join(', ')}`);
    this.logger.debug(`Structured query: "${structuredQuery}"`);
    return structuredQuery;
  }

  /**
   * Determines the outcome (FAILED, SUCCESS, WARNING, etc.) from query and metadata.
   */
  private determineOutcome(query: string, metadata: QueryMetadata): string {
    const lowerQuery = query.toLowerCase();

    if (metadata.hasError || metadata.errorCode) {
      return 'FAILED';
    }

    if (
      OUTCOME_KEYWORDS.FAILED.some((keyword) => lowerQuery.includes(keyword))
    ) {
      return 'FAILED';
    }
    if (
      OUTCOME_KEYWORDS.SUCCESS.some((keyword) => lowerQuery.includes(keyword))
    ) {
      return 'SUCCESS';
    }
    if (
      OUTCOME_KEYWORDS.WARNING.some((keyword) => lowerQuery.includes(keyword))
    ) {
      return 'WARNING';
    }
    if (
      OUTCOME_KEYWORDS.EDGE_CASE.some((keyword) => lowerQuery.includes(keyword))
    ) {
      return 'EDGE_CASE';
    }

    return 'ANY';
  }

  /**
   * Extracts user role hints from the query.
   */
  private extractUserRole(query: string): string | null {
    const lowerQuery = query.toLowerCase();
    const roleKeywords = USER_ROLES_KEYWORDS;

    for (const [role, keywords] of Object.entries(roleKeywords)) {
      if (keywords.some((keyword) => lowerQuery.includes(keyword))) {
        return role;
      }
    }

    return null;
  }

  /**
   * Extracts latency bucket hints from the query.
   */
  private extractLatencyBucket(query: string): string | null {
    const lowerQuery = query.toLowerCase();
    const latencyKeywords = LATENCY_KEYWORDS;

    for (const [bucket, keywords] of Object.entries(latencyKeywords)) {
      if (keywords.some((keyword) => lowerQuery.includes(keyword))) {
        return bucket;
      }
    }

    return null;
  }

  /**
   * Normalizes service name to ensure consistency (e.g., "payment" -> "payments").
   * This helps match queries with documents that use plural service names.
   *
   * @param service The service name from metadata
   * @returns Normalized service name or null
   */
  private normalizeService(service: string | null): string | null {
    if (!service) {
      return null;
    }

    const lowerService = service.toLowerCase().trim();

    // Common service name mappings (singular -> plural)
    const serviceMappings = SERVICE_MAP_CONSTANTS;

    // Check if we have a mapping
    if (serviceMappings[lowerService]) {
      return serviceMappings[lowerService];
    }

    // If already plural or doesn't match, return as-is
    return service;
  }

  /**
   * Extracts route path from query using keyword-based extraction.
   * This complements LLM-based metadata extraction for route information.
   *
   * @param query The original natural language query
   * @param metadata Extracted metadata (may contain route from LLM)
   * @returns Route path or null
   *
   * @example
   * "checkout requests" -> "/payments/checkout"
   * "payment endpoint" -> "/payments"
   */
  private extractRoute(query: string, metadata: QueryMetadata): string | null {
    // First, check if route is already extracted by LLM
    if (metadata.route) {
      return metadata.route;
    }

    const lowerQuery = query.toLowerCase();

    // Common route patterns and their keywords
    const routePatterns = ROUTE_PATTERN_CONSTANTS;

    // Find matching route pattern
    for (const pattern of routePatterns) {
      if (pattern.keywords.some((keyword) => lowerQuery.includes(keyword))) {
        this.logger.debug(
          `Extracted route "${pattern.route}" from query keywords`,
        );
        return pattern.route;
      }
    }

    // Try to extract route-like patterns (e.g., "/payments/checkout")
    const routeRegex = /(\/[a-z0-9\-_\/]+)/gi;
    const routeMatches = query.match(routeRegex);
    if (routeMatches && routeMatches.length > 0) {
      // Return the first route-like pattern found
      const extractedRoute = routeMatches[0];
      this.logger.debug(
        `Extracted route "${extractedRoute}" from query pattern`,
      );
      return extractedRoute;
    }

    return null;
  }

  /**
   * Creates multiple query variations for better semantic matching.
   * This implements a chunking-like strategy where we generate multiple
   * structured queries from a single natural language query.
   *
   * @param query The original natural language query
   * @param metadata Extracted metadata from the query
   * @returns Array of structured query strings
   */
  createQueryVariations(query: string, metadata: QueryMetadata): string[] {
    const variations: string[] = [];

    const primary = this.preprocessQuery(query, metadata);
    variations.push(primary);

    if (metadata.hasError || metadata.errorCode) {
      const errorFocused = this.preprocessQuery(query, {
        ...metadata,
        hasError: true,
      });
      if (errorFocused !== primary) {
        variations.push(errorFocused);
      }
    }

    if (metadata.service) {
      const serviceFocused = `Service: ${metadata.service}`;
      variations.push(serviceFocused);
    }

    variations.push(query);

    return variations;
  }
}
