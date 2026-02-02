import { Request } from "express";

/**
 * RouteNormalizer - Creates canonical route identifiers for consistent logging.
 *
 * Problem:
 * - request.route?.path may be empty depending on the environment
 * - Base path may be missing
 * - Query strings may or may not be included inconsistently
 *
 * Solution:
 * - Normalize all routes to a consistent format: "METHOD /path"
 * - Prefer template paths (with :params) over actual paths
 * - Strip query strings
 * - Handle base path via environment variable
 *
 * @example
 * // Template path available (NestJS standard)
 * RouteNormalizer.normalize(request) // "POST /payments/:id"
 *
 * // Fallback to actual path
 * RouteNormalizer.normalize(request) // "GET /users/123"
 */
export class RouteNormalizer {
  /**
   * Canonical route generation rules:
   * 1. Method is always uppercase
   * 2. Prefer template path (request.route?.path) for consistency
   * 3. Fallback: request.path with query string stripped
   * 4. Base path is normalized via API_BASE_PATH environment variable
   */
  static normalize(request: Request): string {
    const method = request.method.toUpperCase();
    const templatePath = this.getTemplatePath(request);
    const actualPath = this.stripQueryString(request.path);
    const basePath = process.env.API_BASE_PATH || "";

    // Prefer template path for better aggregation (e.g., /users/:id instead of /users/123)
    const path = templatePath || actualPath;

    // Normalize base path handling
    const normalizedPath = this.normalizeBasePath(path, basePath);

    return `${method} ${normalizedPath}`;
  }

  /**
   * Extract template path from Express route.
   * Returns null if not available.
   */
  private static getTemplatePath(request: Request): string | null {
    // Express stores the route path in request.route?.path
    const routePath = (request as any).route?.path;

    if (!routePath) {
      return null;
    }

    // Handle route arrays (rare but possible)
    if (Array.isArray(routePath)) {
      return routePath[0] || null;
    }

    return routePath;
  }

  /**
   * Remove query string from path.
   */
  private static stripQueryString(path: string): string {
    const queryIndex = path.indexOf("?");
    return queryIndex === -1 ? path : path.substring(0, queryIndex);
  }

  /**
   * Normalize path with base path.
   * Ensures consistent formatting regardless of how the path was constructed.
   */
  private static normalizeBasePath(path: string, basePath: string): string {
    // If no base path, return as-is
    if (!basePath) {
      return this.ensureLeadingSlash(path);
    }

    // Remove trailing slash from base path
    const normalizedBase = basePath.endsWith("/")
      ? basePath.slice(0, -1)
      : basePath;

    // If path already starts with base path, return as-is
    if (path.startsWith(normalizedBase)) {
      return this.ensureLeadingSlash(path);
    }

    // Combine base path with path
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    return `${normalizedBase}${normalizedPath}`;
  }

  /**
   * Ensure path starts with a slash.
   */
  private static ensureLeadingSlash(path: string): string {
    return path.startsWith("/") ? path : `/${path}`;
  }

  /**
   * Create a route pattern for matching in SamplingPolicy.
   * Converts actual paths to pattern-matchable format.
   *
   * @example
   * toPattern("GET /users/123") // "GET /users/:id" (if template available)
   */
  static toPattern(route: string): string {
    // For now, return as-is. In future, could implement pattern detection.
    return route;
  }
}
