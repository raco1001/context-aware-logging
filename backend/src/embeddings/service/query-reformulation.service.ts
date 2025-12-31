import { Injectable, Logger } from "@nestjs/common";
import { SynthesisPort } from "@embeddings/out-ports";
import { AnalysisResult } from "@embeddings/domain";

/**
 * QueryReformulationService - Reformulates queries by resolving references.
 *
 * This service handles conversational RAG by resolving ambiguous references
 * (pronouns, "it", "that", "the error", etc.) based on chat history.
 *
 * Example:
 * - History: "어제 에러 있었어?" → "INSUFFICIENT_FUNDS 에러 26건 발생"
 * - Query: "그 에러의 원인은?" → Reformulated: "INSUFFICIENT_FUNDS 에러의 원인은?"
 */
@Injectable()
export class QueryReformulationService {
  private readonly logger = new Logger(QueryReformulationService.name);

  constructor(private readonly synthesisPort: SynthesisPort) {}

  /**
   * Reformulates a query by resolving references based on chat history.
   *
   * @param query The original query that may contain references
   * @param history Chat history to resolve references from
   * @returns Reformulated query with resolved references, or original if no reformulation needed
   */
  async reformulateQuery(
    query: string,
    history: AnalysisResult[],
  ): Promise<string> {
    if (!history || history.length === 0) {
      return query;
    }

    if (!this.hasReferences(query)) {
      this.logger.debug(
        `Query "${query}" has no references, skipping reformulation`,
      );
      return query;
    }

    try {
      const reformulated = await this.synthesisPort.reformulateQuery(
        query,
        history,
      );
      return reformulated;
    } catch (error) {
      this.logger.error(
        `Query reformulation failed: ${error.message}, using original query`,
      );
      return query;
    }
  }

  /**
   * Checks if a query contains potential references that need resolution.
   */
  private hasReferences(query: string): boolean {
    const lowerQuery = query.toLowerCase();

    const referencePatterns = [
      /\b(it|that|this|those|these|the error|the issue|the problem)\b/i,
      /(그|그것|그 에러|그 문제|그 이슈|그것의|그의)/,
    ];

    return referencePatterns.some((pattern) => pattern.test(lowerQuery));
  }
}
