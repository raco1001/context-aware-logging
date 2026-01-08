import { Injectable, Logger } from "@nestjs/common";
import { SearchUseCase } from "@embeddings/in-ports";
import {
  EmbeddingPort,
  RerankPort,
  SynthesisPort,
  LogStoragePort,
} from "@embeddings/out-ports";
import { AnalysisResult } from "@embeddings/dtos";
import { AnalysisIntent } from "@embeddings/value-objects/filter";
import { QueryMetadata } from "@embeddings/dtos";
import {
  STATISTIC_KEYWORDS,
  SEMANTIC_KEYWORDS,
  AGGREGATION_KEYWORDS,
  CONVERSATIONAL_KEYWORDS,
} from "@embeddings/value-objects/filter";
import {
  QueryPreprocessorService,
  AggregationService,
  SessionCacheService,
  QueryReformulationService,
  ContextCompressionService,
  SemanticCacheService,
} from "@embeddings/service/sub-services";

/**
 * SearchService - Service for search operations.
 * Handles RAG queries and chat history retrieval.
 */
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
    private readonly semanticCache: SemanticCacheService,
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
      let history: AnalysisResult[] = [];
      if (sessionId) {
        history = await this.sessionCache.getHistory(sessionId);
        this.logger.debug(
          `Retrieved ${history.length} history turns for session ${sessionId}`,
        );
      }

      // 1. Anchor the original language
      const originalLanguage = this.synthesisPort.detectLanguage(query);

      const intent = this.classifyIntent(query);
      this.logger.log(`Detected intent: ${intent}`);

      if (intent === AnalysisIntent.CONVERSATIONAL) {
        this.logger.log(`Handling conversational query: "${query}"`);

        // If history is empty, provide a default response
        if (history.length === 0) {
          const noHistoryAnswer =
            originalLanguage === "Korean"
              ? "이 세션에서 이전에 나눈 대화 내용이 없습니다."
              : "I don't have any previous conversation records in this session.";

          return {
            question: query,
            intent,
            answer: noHistoryAnswer,
            sources: [],
            confidence: 1,
            sessionId,
            createdAt: new Date(),
          };
        }

        // For conversational intent, use the most recent 10 raw messages for accuracy
        // No need to compress as we are only looking at metadata about the conversation itself.
        const recentHistory = history.slice(-10);

        const { answer, confidence } = await this.synthesisPort.synthesize(
          query,
          [],
          recentHistory,
          originalLanguage,
        );

        const result: AnalysisResult = {
          question: query,
          intent,
          answer,
          sources: [],
          confidence,
          sessionId,
          createdAt: new Date(),
        };

        if (sessionId) {
          await this.sessionCache.updateSession(sessionId, result);
        }
        return result;
      }

      const reformulatedQuery = await this.queryReformulation.reformulateQuery(
        query,
        history,
      );

      // 2. Safe Guard: If reformulation translated the query, fallback to original
      const safeReformulatedQuery =
        this.synthesisPort.detectLanguage(reformulatedQuery) !==
        originalLanguage
          ? query
          : reformulatedQuery;

      if (safeReformulatedQuery !== reformulatedQuery) {
        this.logger.warn(
          `Reformulation translation detected! Falling back to original query to maintain language sovereignty.`,
        );
      }

      const isStandalone = this.isStandaloneQuery(query, safeReformulatedQuery);
      if (isStandalone) {
        this.logger.log(
          `Detected standalone query: "${query}" (History bypassed)`,
        );
      } else {
        this.logger.log(
          `Detected context-dependent query: "${query}" -> "${safeReformulatedQuery}"`,
        );
      }

      // Construct compressedHistory ONLY for the RAG flow to save tokens and focus context
      const compressedHistory =
        history.length > 10
          ? await this.contextCompression.compressHistory(history)
          : history;

      const metadata = await this.synthesisPort.extractMetadata(
        safeReformulatedQuery,
      );

      this.logger.log(
        `Extracted metadata from reformulated query: ${JSON.stringify(metadata)}`,
      );

      if (intent === AnalysisIntent.STATISTICAL) {
        return await this.handleStatisticalQuery(
          safeReformulatedQuery,
          metadata,
          compressedHistory,
          sessionId,
          query,
          isStandalone,
          originalLanguage,
        );
      }

      return await this.handleSemanticQuery(
        safeReformulatedQuery,
        metadata,
        compressedHistory,
        sessionId,
        query,
        isStandalone,
        originalLanguage,
      );
    } catch (error) {
      this.logger.error(`RAG process failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Handles semantic queries using vector search + rerank + synthesis.
   */
  private async handleSemanticQuery(
    reformulatedQuery: string,
    metadata: QueryMetadata,
    history: AnalysisResult[],
    sessionId?: string,
    originalQuery?: string,
    isStandalone: boolean = false,
    targetLanguage?: "Korean" | "English",
  ): Promise<AnalysisResult> {
    const intent = AnalysisIntent.SEMANTIC;
    const query = originalQuery || reformulatedQuery;

    // Transform query to log-style narrative for better semantic matching
    const logStyleQuery =
      await this.synthesisPort.transformQueryToLogStyle(reformulatedQuery);

    const structuredQuery = this.queryPreprocessor.preprocessQuery(
      logStyleQuery,
      metadata,
    );

    this.logger.log(
      `\n\n 
        Original query: "${query}" \n
        -> Transformed query (log-style): "${logStyleQuery}" \n
        -> Structured query: "${structuredQuery}" \n`,
    );

    const { embedding } =
      await this.embeddingPort.createEmbedding(structuredQuery);

    this.logger.log(
      `Performing vector search with embedding (dimension: ${embedding.length}), metadata: ${JSON.stringify(metadata)}`,
    );

    let vectorResults = this.semanticCache.getCachedResults(
      embedding,
      metadata,
    );

    if (vectorResults && vectorResults.length > 0) {
      this.logger.log(
        `Semantic cache hit! Using cached vector results (${vectorResults.length} results)`,
      );
    } else {
      this.logger.log(
        vectorResults
          ? `Semantic cache hit but empty results, performing vector search`
          : `Semantic cache miss, performing vector search`,
      );
      vectorResults = await this.logStoragePort.vectorSearch(
        embedding,
        10,
        metadata,
      );

      if (vectorResults && vectorResults.length > 0) {
        this.semanticCache.setCachedResults(embedding, metadata, vectorResults);
      }
    }

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

    const synthesisHistory = isStandalone ? [] : history;

    const { answer, confidence } = await this.synthesisPort.synthesize(
      reformulatedQuery,
      fullLogs,
      synthesisHistory,
      targetLanguage,
    );

    this.logger.log(
      `Synthesized answer (raw): "${answer.substring(0, 100)}${answer.length > 100 ? "..." : ""}" (confidence: ${confidence})`,
    );

    let finalAnswer = answer;
    let finalConfidence = confidence;
    try {
      const verification = await this.synthesisPort.verifyGrounding(
        reformulatedQuery,
        answer,
        fullLogs,
      );

      this.logger.log(
        `Grounding verification: ${verification.status}, action: ${verification.action}`,
      );

      if (verification.action === "REJECT_ANSWER") {
        finalAnswer = "Not enough evidence to provide a reliable answer.";
        finalConfidence = 0;
        this.logger.warn(
          `Answer rejected due to insufficient grounding. Unverified claims: ${verification.unverifiedClaims.join(", ")}`,
        );
      } else if (verification.action === "ADJUST_CONFIDENCE") {
        finalConfidence = Math.min(
          confidence,
          confidence * verification.confidenceAdjustment,
        );
        if (verification.unverifiedClaims.length > 0) {
          finalAnswer = `${answer}\n\n[Note: Some claims could not be fully verified: ${verification.unverifiedClaims.join(", ")}]`;
        }
        this.logger.log(
          `Confidence adjusted from ${confidence} to ${finalConfidence} based on verification`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Grounding verification failed, using original answer: ${error.message}`,
      );
    }

    const result: AnalysisResult = {
      question: query,
      intent,
      answer: finalAnswer,
      sources: requestIds,
      confidence: finalConfidence,
      sessionId,
      createdAt: new Date(),
    };

    if (sessionId) {
      // For standalone queries, we update the session cache with the new result
      // but we don't necessarily need the history for the NEXT standalone query.
      await this.sessionCache.updateSession(sessionId, result);
    }

    return result;
  }

  /**
   * Detects if a query is standalone or depends on history.
   * If reformulated query is essentially the same as original, it's likely standalone.
   */
  private isStandaloneQuery(original: string, reformulated: string): boolean {
    const normOriginal = original.toLowerCase().trim().replace(/[?.!]/g, "");
    const normReformulated = reformulated
      .toLowerCase()
      .trim()
      .replace(/[?.!]/g, "");

    // If they are very similar, consider it standalone
    return (
      normOriginal === normReformulated ||
      normReformulated.includes(normOriginal) ||
      normOriginal.length / normReformulated.length > 0.8
    );
  }

  /**
   * Handles statistical/aggregation queries using MongoDB aggregation pipelines.
   */
  private async handleStatisticalQuery(
    reformulatedQuery: string,
    metadata: QueryMetadata,
    history: AnalysisResult[],
    sessionId?: string,
    originalQuery?: string,
    isStandalone: boolean = false,
    targetLanguage?: "Korean" | "English",
  ): Promise<AnalysisResult> {
    const intent = AnalysisIntent.STATISTICAL;
    const query = originalQuery || reformulatedQuery;
    this.logger.log(`Handling statistical query: "${reformulatedQuery}"`);

    try {
      const { templateId, params } =
        await this.synthesisPort.analyzeStatisticalQuery(
          reformulatedQuery,
          metadata,
        );
      this.logger.log(
        `LLM detected template: ${templateId}, params: ${JSON.stringify(params)}`,
      );

      const aggregationResults = await this.aggregation.executeTemplate(
        templateId,
        params,
      );

      let contextLogs: any[] = [];
      if (aggregationResults && aggregationResults.length > 0) {
        // Use log-style transformation for better context log retrieval
        const logStyleQuery =
          await this.synthesisPort.transformQueryToLogStyle(reformulatedQuery);
        const searchMetadata = params.metadata || metadata;
        const structuredQuery = this.queryPreprocessor.preprocessQuery(
          logStyleQuery,
          searchMetadata,
        );

        const { embedding } =
          await this.embeddingPort.createEmbedding(structuredQuery);

        contextLogs = this.semanticCache.getCachedResults(
          embedding,
          searchMetadata,
        );

        if (contextLogs && contextLogs.length > 0) {
          this.logger.log(
            `Semantic cache hit for statistical query context logs (${contextLogs.length} results)`,
          );
          contextLogs = contextLogs.slice(0, 5);
        } else {
          this.logger.log(
            contextLogs
              ? `Semantic cache hit but empty results for statistical query, performing vector search`
              : `Semantic cache miss for statistical query, performing vector search`,
          );
          contextLogs = await this.logStoragePort.vectorSearch(
            embedding,
            5,
            searchMetadata,
          );

          if (contextLogs && contextLogs.length > 0) {
            this.semanticCache.setCachedResults(
              embedding,
              searchMetadata,
              contextLogs,
            );
          }
        }
      }

      const synthesisContext = {
        aggregationResults,
        contextLogs: contextLogs.slice(0, 5),
      };

      const synthesisHistory = isStandalone ? [] : history;

      const { answer, confidence } = await this.synthesisPort.synthesize(
        reformulatedQuery,
        [synthesisContext],
        synthesisHistory,
        targetLanguage,
      );

      this.logger.log(
        `Synthesized statistical answer (raw): "${answer.substring(0, 100)}${answer.length > 100 ? "..." : ""}" (confidence: ${confidence})`,
      );

      let finalAnswer = answer;
      let finalConfidence = confidence;
      try {
        const verificationContext = [
          ...(aggregationResults || []),
          ...(contextLogs.slice(0, 5) || []),
        ];

        const verification = await this.synthesisPort.verifyGrounding(
          reformulatedQuery,
          answer,
          verificationContext,
        );

        this.logger.log(
          `Grounding verification: ${verification.status}, action: ${verification.action}`,
        );

        if (verification.action === "REJECT_ANSWER") {
          finalAnswer = "Not enough evidence to provide a reliable answer.";
          finalConfidence = 0;
          this.logger.warn(
            `Answer rejected due to insufficient grounding. Unverified claims: ${verification.unverifiedClaims.join(", ")}`,
          );
        } else if (verification.action === "ADJUST_CONFIDENCE") {
          finalConfidence = Math.min(
            confidence,
            confidence * verification.confidenceAdjustment,
          );
          if (verification.unverifiedClaims.length > 0) {
            finalAnswer = `${answer}\n\n[Note: Some claims could not be fully verified: ${verification.unverifiedClaims.join(", ")}]`;
          }
          this.logger.log(
            `Confidence adjusted from ${confidence} to ${finalConfidence} based on verification`,
          );
        }
      } catch (error) {
        this.logger.error(
          `Grounding verification failed, using original answer: ${error.message}`,
        );
      }

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
        answer: finalAnswer,
        sources: requestIds,
        confidence: finalConfidence,
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

    const conversationalKeywords = [...CONVERSATIONAL_KEYWORDS];

    if (conversationalKeywords.some((k) => lowerQuery.includes(k))) {
      return AnalysisIntent.CONVERSATIONAL;
    }

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
   * Creates an empty result for a query.
   * @param question The query.
   * @param intent The intent.
   * @param sessionId The session ID.
   * @returns The empty result.
   */
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
