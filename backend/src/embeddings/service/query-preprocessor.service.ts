import { Injectable, Logger } from "@nestjs/common";
import { QueryMetadata } from "@embeddings/dtos";

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

    const outcome = this.determineOutcome(query, metadata);
    // Normalize service name (singular -> plural)
    const service = this.normalizeService(metadata.service) || "ANY";
    const route = this.extractRoute(query, metadata) || "ANY";
    const errorCode =
      metadata.errorCode || (metadata.hasError ? "ANY" : "NONE");
    const errorMessage = metadata.hasError ? "ANY" : "NONE";
    const userRole = this.extractUserRole(query) || "ANY";
    const latencyBucket = this.extractLatencyBucket(query) || "ANY";

    const structuredQuery = `Outcome: ${outcome}, Service: ${service}, Route: ${route}, Error: ${errorCode}, ErrorMessage: ${errorMessage}, UserRole: ${userRole}, LatencyBucket: ${latencyBucket}`;

    this.logger.debug(`Structured query: "${structuredQuery}"`);
    return structuredQuery;
  }

  /**
   * Determines the outcome (FAILED, SUCCESS, WARNING, etc.) from query and metadata.
   */
  private determineOutcome(query: string, metadata: QueryMetadata): string {
    const lowerQuery = query.toLowerCase();

    if (metadata.hasError || metadata.errorCode) {
      return "FAILED";
    }

    const failureKeywords = [
      "failed",
      "failure",
      "error",
      "errors",
      "exception",
      "timeout",
      "broken",
      "down",
      "issue",
      "problem",
    ];
    if (failureKeywords.some((keyword) => lowerQuery.includes(keyword))) {
      return "FAILED";
    }

    const successKeywords = ["success", "succeeded", "working", "ok"];
    if (successKeywords.some((keyword) => lowerQuery.includes(keyword))) {
      return "SUCCESS";
    }

    const warningKeywords = ["slow", "latency", "warning", "degraded"];
    if (warningKeywords.some((keyword) => lowerQuery.includes(keyword))) {
      return "WARNING";
    }

    return "ANY";
  }

  /**
   * Extracts user role hints from the query.
   */
  private extractUserRole(query: string): string | null {
    const lowerQuery = query.toLowerCase();
    const roleKeywords = {
      PREMIUM: ["premium", "paid", "subscription"],
      ADMIN: ["admin", "administrator"],
      ANONYMOUS: ["anonymous", "guest"],
    };

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
    const latencyKeywords = {
      P_UNDER_100MS: ["fast", "quick", "<100ms", "under 100"],
      P_100_500MS: ["100-500", "100 to 500"],
      P_500_1000MS: ["500-1000", "500 to 1000", "half second"],
      P_OVER_1000MS: ["slow", ">1000ms", "over 1000", "second", "timeout"],
    };

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
    const serviceMappings: Record<string, string> = {
      payment: "payments",
      embedding: "embeddings",
      user: "users",
      order: "orders",
      product: "products",
      cart: "carts",
      checkout: "checkouts",
    };

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
    const routePatterns: Array<{ keywords: string[]; route: string }> = [
      {
        keywords: ["checkout", "check-out", "check out"],
        route: "/payments/checkout",
      },
      {
        keywords: ["payment", "pay", "billing"],
        route: "/payments",
      },
      {
        keywords: ["embedding", "embed", "vector"],
        route: "/embeddings",
      },
      {
        keywords: ["search", "query", "ask"],
        route: "/search",
      },
      {
        keywords: ["user", "profile", "account"],
        route: "/users",
      },
      {
        keywords: ["order", "purchase"],
        route: "/orders",
      },
      {
        keywords: ["product", "item", "catalog"],
        route: "/products",
      },
      {
        keywords: ["cart", "basket"],
        route: "/carts",
      },
    ];

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

    const lowerQuery = query.toLowerCase();

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
      const serviceFocused = `Outcome: ANY, Service: ${metadata.service}, Route: ANY, Error: ANY, ErrorMessage: ANY, UserRole: ANY, LatencyBucket: ANY`;
      variations.push(serviceFocused);
    }

    variations.push(query);

    return variations;
  }
}
