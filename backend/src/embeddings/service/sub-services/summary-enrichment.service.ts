import { Injectable } from "@nestjs/common";
import { WideEvent } from "@logging/domain";
import { Latency } from "@logging/domain";
import { LatencyBucket } from "@logging/value-objects";

/**
 * SummaryEnrichmentService - Generates Dual-layer Summary for embedding purposes.
 *
 * This service is responsible for creating enriched summaries that combine:
 * - Narrative Layer: Natural language surface for better query matching
 * - Canonical Layer: Structured format for filtering and aggregation
 *
 * This responsibility belongs to the embedding module, not the logging module,
 * as it's specifically for embedding optimization.
 */
@Injectable()
export class SummaryEnrichmentService {
  /**
   * Generates a Dual-layer Summary from a WideEvent.
   * Combines deterministic canonical signals with lightweight narrative surface
   * to balance reproducibility and natural language recall.
   *
   * @param event The WideEvent to generate summary from
   * @returns Dual-layer summary string (narrative + canonical)
   */
  generateDualLayerSummary(event: WideEvent): string {
    const errorCode = event.error?.code ?? "NONE";
    const errorMessage = event.error?.message ?? "NONE";
    const userRole = event.user?.role ?? "ANONYMOUS";
    const latencyBucket = Latency.getBucket(event.performance?.durationMs);
    const outcome = event.error
      ? "FAILED"
      : latencyBucket === LatencyBucket.P_OVER_1000MS
        ? "WARNING"
        : latencyBucket === LatencyBucket.P_UNKNOWN
          ? "EDGE_CASE"
          : "SUCCESS";

    // Canonical Layer (구조화된 의미 축 - 통계/집계/안정성 담당)
    const canonical = `Outcome: ${outcome}, Service: ${event.service}, Route: ${event.route}, Error: ${errorCode}, ErrorMessage: ${errorMessage}, UserRole: ${userRole}, LatencyBucket: ${latencyBucket}`;

    // Narrative Layer (얕은 자연어 서술 - 언어 접점 역할)
    // LLM 없이 코드로 생성하여 결정론적이고 재현 가능함
    const narrative = this.generateNarrative(
      outcome,
      errorCode,
      errorMessage,
      event.service,
      event.route,
      userRole,
    );

    // Dual-layer Summary: Narrative + Canonical
    // 임베딩 시 전체 문자열을 사용하여 자연어 쿼리와 구조화된 정보 모두 활용
    return `${narrative}\n\n${canonical}`;
  }

  /**
   * Generates a deterministic narrative sentence from structured context.
   * This is NOT LLM-based - uses template-based generation for reproducibility.
   * The narrative provides a "language surface" for natural language queries
   * while maintaining deterministic behavior.
   *
   * @param outcome Event outcome (FAILED, SUCCESS, WARNING, etc.)
   * @param errorCode Error code if any
   * @param errorMessage Error message if any
   * @param service Service name
   * @param route Route path
   * @param userRole User role
   * @returns A simple natural language sentence describing the event
   */
  private generateNarrative(
    outcome: string,
    errorCode: string,
    errorMessage: string,
    service: string,
    route: string,
    userRole: string,
  ): string {
    const serviceName = this.getServiceDisplayName(service);
    const routeName = this.getRouteDisplayName(route);
    const roleName = this.getRoleDisplayName(userRole);

    if (outcome === "FAILED") {
      if (errorCode !== "NONE") {
        const errorDesc = this.getErrorDescription(errorCode);
        if (errorMessage !== "NONE") {
          return `A ${roleName} user experienced a ${serviceName} failure during ${routeName} due to ${errorDesc}: ${errorMessage}.`;
        }
        return `A ${roleName} user experienced a ${serviceName} failure during ${routeName} due to ${errorDesc}.`;
      }
      return `A ${roleName} user experienced a ${serviceName} failure during ${routeName}.`;
    } else if (outcome === "WARNING") {
      return `A ${roleName} user encountered slow performance during ${serviceName} ${routeName}.`;
    } else if (outcome === "EDGE_CASE") {
      return `An edge case occurred for a ${roleName} user during ${serviceName} ${routeName}.`;
    } else {
      return `A ${roleName} user successfully completed ${serviceName} ${routeName}.`;
    }
  }

  /**
   * Converts service name to a more natural display form.
   * Example: "payments" -> "payment", "embeddings" -> "embedding"
   */
  private getServiceDisplayName(service: string): string {
    const mappings: Record<string, string> = {
      payments: "payment",
      embeddings: "embedding",
    };
    return mappings[service] || service;
  }

  /**
   * Extracts a readable route name from the route path.
   * Example: "POST /payments/checkout" -> "checkout"
   * Example: "GET /users/profile" -> "profile access"
   */
  private getRouteDisplayName(route: string): string {
    // Remove HTTP method prefix if present
    const routePath = route.replace(/^(GET|POST|PUT|DELETE|PATCH)\s+/i, "");

    // Extract the last meaningful part
    const parts = routePath.split("/").filter(Boolean);
    if (parts.length > 1) {
      const lastPart = parts[parts.length - 1];
      // Convert common route names to more natural forms
      const routeMappings: Record<string, string> = {
        checkout: "checkout",
        profile: "profile access",
        login: "login",
        register: "registration",
      };
      return routeMappings[lastPart] || lastPart;
    }
    return routePath || route;
  }

  /**
   * Converts role enum/value to a natural language form.
   */
  private getRoleDisplayName(role: string): string {
    const mappings: Record<string, string> = {
      PREMIUM: "premium",
      ADMIN: "admin",
      ANONYMOUS: "anonymous",
      ANONYMOUS_USER: "anonymous",
      GUEST: "guest",
    };
    return mappings[role] || role.toLowerCase();
  }

  /**
   * Converts error code to a more readable description.
   */
  private getErrorDescription(errorCode: string): string {
    const mappings: Record<string, string> = {
      GATEWAY_TIMEOUT: "gateway timeout",
      INSUFFICIENT_BALANCE: "insufficient balance",
      VALIDATION_ERROR: "validation error",
      UNAUTHORIZED: "authorization failure",
      NOT_FOUND: "resource not found",
      INTERNAL_ERROR: "internal error",
    };
    return mappings[errorCode] || errorCode.toLowerCase().replace(/_/g, " ");
  }
}

