import { Injectable, Logger } from "@nestjs/common";
import { SearchUseCase } from "@embeddings/in-ports";
import {
  EmbeddingPort,
  RerankPort,
  SynthesisPort,
  LogStoragePort,
} from "@embeddings/out-ports";
import { AnalysisResult, AnalysisIntent } from "@embeddings/domain";
import {
  STATISTIC_KEYWORDS,
  SEMANTIC_KEYWORDS,
  AGGREGATION_KEYWORDS,
} from "@embeddings/value-objects/filter";
import { QueryPreprocessorService } from "./query-preprocessor.service";
import { AggregationService } from "./aggregation.service";
import { SessionCacheService } from "./session-cache.service";
import { QueryReformulationService } from "./query-reformulation.service";
import { ContextCompressionService } from "./context-compression.service";

@Injectable()
export class SearchService extends SearchUseCase {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private readonly embeddingPort: EmbeddingPort,
    private readonly rerankPort: RerankPort,
    private readonly synthesisPort: SynthesisPort,
    private readonly logStoragePort: LogStoragePort,
    private readonly queryPreprocessor: QueryPreprocessorService,
    private readonly aggregation: AggregationService,
    private readonly sessionCache: SessionCacheService,
    private readonly queryReformulation: QueryReformulationService,
    private readonly contextCompression: ContextCompressionService,
  ) {
    super();
  }

  /**
   * Performs a full RAG (Retrieval-Augmented Generation) search.
   * @param query The user's natural language question.
   * @param sessionId The session ID for chat history.
   * @returns The analysis result containing the answer, confidence, and source.
   */
  async ask(query: string, sessionId?: string): Promise<AnalysisResult> {
    this.logger.log(
      `Processing RAG query: "${query}" (Session: ${sessionId || "none"})`,
    );

    try {
      const metadata = await this.synthesisPort.extractMetadata(query);
      const intent = this.classifyIntent(query);
      this.logger.log(`Extracted metadata: ${JSON.stringify(metadata)}`);
      this.logger.log(`Detected intent: ${intent}`);

      // Route to statistical or semantic handler
      if (intent === AnalysisIntent.STATISTICAL) {
        return await this.handleStatisticalQuery(query, metadata, sessionId);
      }

      // Default to semantic query handling
      return await this.handleSemanticQuery(query, metadata, sessionId);
    } catch (error) {
      this.logger.error(`RAG process failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Handles semantic queries using vector search + rerank + synthesis.
   */
  private async handleSemanticQuery(
    query: string,
    metadata: any,
    sessionId?: string,
  ): Promise<AnalysisResult> {
    const intent = AnalysisIntent.SEMANTIC;

    let history: AnalysisResult[] = [];
    if (sessionId) {
      history = await this.sessionCache.getHistory(sessionId);
      this.logger.debug(
        `Retrieved ${history.length} history turns for session ${sessionId}`,
      );
    }

    const reformulatedQuery = await this.queryReformulation.reformulateQuery(
      query,
      history,
    );

    const compressedHistory =
      history.length > 10
        ? await this.contextCompression.compressHistory(history)
        : history;

    const structuredQuery = this.queryPreprocessor.preprocessQuery(
      reformulatedQuery,
      metadata,
    );
    this.logger.log(
      `\n\n 
        Original query: "${query}" \n\n
        -> Structured query: "${structuredQuery}" \n\n`,
    );

    const { embedding } =
      await this.embeddingPort.createEmbedding(structuredQuery);

    this.logger.log(
      `Performing vector search with embedding (dimension: ${embedding.length}), metadata: ${JSON.stringify(metadata)}`,
    );

    const vectorResults = await this.logStoragePort.vectorSearch(
      embedding,
      10,
      metadata,
    );

    this.logger.log(
      `Vector search returned ${vectorResults?.length || 0} results`,
    );

    if (!vectorResults || vectorResults.length === 0) {
      this.logger.warn(
        `No vector search results found. This could mean:
          1. No embeddings exist in wide_events_embedded collection
          2. Service filter is too strict (filtering by: ${metadata.service || "none"})
          3. Vector search index may not be properly configured
          Consider running: POST /embeddings/batch?limit=100 to create embeddings`,
      );
      return this.createEmptyResult(query, intent, sessionId);
    }

    if (vectorResults.length > 0) {
      this.logger.log(
        `Top 3 vector search results:\n${vectorResults
          .slice(0, 3)
          .map(
            (r, i) =>
              `  ${i + 1}. Score: ${r.score?.toFixed(4) || "N/A"}, Summary: ${r.summary?.substring(0, 100) || "N/A"}`,
          )
          .join("\n")}`,
      );
    }

    const documentsForRerank = vectorResults.map((res) => res.summary);
    const rerankedIndices = await this.rerankPort.rerank(
      query,
      documentsForRerank,
      5,
    );
    this.logger.log(
      `Reranked indices: ${JSON.stringify(rerankedIndices, null, 2)}`,
    );
    const topResults = rerankedIndices.map((item) => vectorResults[item.index]);

    this.logger.log(`Top results: ${JSON.stringify(topResults, null, 2)}`);

    const eventIds = topResults.map((res) => res.eventId);

    let fullLogs = await this.logStoragePort.getLogsByEventIds(eventIds);
    this.logger.log(`Full logs: ${JSON.stringify(fullLogs, null, 2)}`);
    if (metadata.hasError || metadata.errorCode) {
      fullLogs = fullLogs.filter((log) => {
        if (metadata.hasError && !log.error) {
          return false;
        }
        if (metadata.errorCode && log.error?.code !== metadata.errorCode) {
          return false;
        }
        return true;
      });
      this.logger.log(`Filtered logs: ${JSON.stringify(fullLogs, null, 2)}`);
      if (fullLogs.length === 0) {
        this.logger.warn(
          `Post-filtering removed all results. Original count: ${eventIds.length}, Filtered: 0`,
        );
      }
    }

    const requestIds = fullLogs.map((log) => log.requestId).filter(Boolean);

    const { answer, confidence } = await this.synthesisPort.synthesize(
      reformulatedQuery,
      fullLogs,
      compressedHistory,
    );

    const result: AnalysisResult = {
      question: query, // Store original query in result
      intent,
      answer,
      sources: requestIds,
      confidence,
      sessionId,
    };

    if (sessionId) {
      await this.sessionCache.updateSession(sessionId, result);
    }

    return result;
  }

  /**
   * Handles statistical/aggregation queries using MongoDB aggregation pipelines.
   */
  private async handleStatisticalQuery(
    query: string,
    metadata: any,
    sessionId?: string,
  ): Promise<AnalysisResult> {
    const intent = AnalysisIntent.STATISTICAL;
    this.logger.log(`Handling statistical query: "${query}"`);

    try {
      let history: AnalysisResult[] = [];
      if (sessionId) {
        history = await this.sessionCache.getHistory(sessionId);
        this.logger.debug(
          `Retrieved ${history.length} history turns for session ${sessionId}`,
        );
      }

      const reformulatedQuery = await this.queryReformulation.reformulateQuery(
        query,
        history,
      );

      const compressedHistory =
        history.length > 10
          ? await this.contextCompression.compressHistory(history)
          : history;

      const aggregationType = this.parseAggregationType(reformulatedQuery);
      this.logger.log(`Detected aggregation type: ${aggregationType}`);

      let aggregationResults: any;
      let contextLogs: any[] = [];

      if (aggregationType === "error_code_top_n") {
        const topN = this.extractTopN(query) || 5;
        aggregationResults = await this.aggregation.aggregateErrorCodesByCount(
          metadata,
          topN,
        );
      } else if (aggregationType === "error_by_route") {
        const topN = this.extractTopN(query) || 5;
        aggregationResults = await this.aggregation.aggregateErrorsByRoute(
          metadata,
          topN,
        );
      } else if (aggregationType === "error_by_service") {
        aggregationResults =
          await this.aggregation.aggregateErrorsByService(metadata);
      } else {
        const topN = this.extractTopN(query) || 5;
        aggregationResults = await this.aggregation.aggregateErrorCodesByCount(
          metadata,
          topN,
        );
      }

      if (aggregationResults && aggregationResults.length > 0) {
        const { embedding } =
          await this.embeddingPort.createEmbedding(reformulatedQuery);
        contextLogs = await this.logStoragePort.vectorSearch(
          embedding,
          5,
          metadata,
        );
      }

      const synthesisContext = {
        aggregationResults,
        contextLogs: contextLogs.slice(0, 5),
      };

      const { answer, confidence } = await this.synthesisPort.synthesize(
        reformulatedQuery,
        [synthesisContext],
        compressedHistory,
      );

      const requestIds = aggregationResults
        ? aggregationResults
            .flatMap((result: any) =>
              result.examples
                ? result.examples.map((ex: any) => ex.requestId)
                : [],
            )
            .filter(Boolean)
        : [];

      const result: AnalysisResult = {
        question: query,
        intent,
        answer,
        sources: requestIds,
        confidence,
        sessionId,
      };

      if (sessionId) {
        await this.sessionCache.updateSession(sessionId, result);
      }

      return result;
    } catch (error) {
      this.logger.error(
        `Statistical query handling failed: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async getChatHistory(sessionId: string): Promise<AnalysisResult[]> {
    return this.sessionCache.getHistory(sessionId);
  }

  private classifyIntent(query: string): AnalysisIntent {
    const lowerQuery = query.toLowerCase();
    const statisticalKeywords = STATISTIC_KEYWORDS;
    const semanticKeywords = SEMANTIC_KEYWORDS;

    const aggregationKeywords = AGGREGATION_KEYWORDS;

    if (
      aggregationKeywords.some((k) => lowerQuery.includes(k)) ||
      statisticalKeywords.some((k) => lowerQuery.includes(k))
    ) {
      return AnalysisIntent.STATISTICAL;
    } else if (semanticKeywords.some((k) => lowerQuery.includes(k))) {
      return AnalysisIntent.SEMANTIC;
    }

    return AnalysisIntent.UNKNOWN;
  }

  /**
   * Parses the aggregation type from the query.
   * Returns: "error_code_top_n", "error_by_route", "error_by_service", or "unknown"
   */
  private parseAggregationType(query: string): string {
    const lowerQuery = query.toLowerCase();

    if (
      lowerQuery.includes("원인") ||
      lowerQuery.includes("error code") ||
      lowerQuery.includes("에러 코드") ||
      (lowerQuery.includes("에러") && lowerQuery.includes("상위"))
    ) {
      return "error_code_top_n";
    }

    if (
      lowerQuery.includes("route") ||
      lowerQuery.includes("경로") ||
      lowerQuery.includes("엔드포인트")
    ) {
      return "error_by_route";
    }

    if (
      lowerQuery.includes("service") ||
      lowerQuery.includes("서비스") ||
      lowerQuery.includes("별")
    ) {
      return "error_by_service";
    }

    return "error_code_top_n";
  }

  /**
   * Extracts the "top N" number from the query.
   * Returns the number if found, otherwise null.
   */
  private extractTopN(query: string): number | null {
    const lowerQuery = query.toLowerCase();

    const patterns = [
      /상위\s*(\d+)/,
      /top\s*(\d+)/,
      /(\d+)\s*개/,
      /(\d+)\s*개만/,
      /(\d+)\s*개에\s*대해서만/,
    ];

    for (const pattern of patterns) {
      const match = lowerQuery.match(pattern);
      if (match && match[1]) {
        const num = parseInt(match[1], 10);
        if (!isNaN(num) && num > 0) {
          return num;
        }
      }
    }

    return null;
  }

  private createEmptyResult(
    question: string,
    intent: AnalysisIntent,
    sessionId?: string,
  ): AnalysisResult {
    return {
      question,
      intent,
      answer: "Not enough evidence.",
      sources: [],
      sessionId,
      confidence: 0,
    };
  }
}
