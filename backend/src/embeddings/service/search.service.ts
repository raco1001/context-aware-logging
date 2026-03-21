import { Injectable, Logger, Inject } from "@nestjs/common";
import {
  SearchUseCase,
  QueryStrategy,
  QueryContext,
  QUERY_STRATEGIES,
} from "@embeddings/in-ports";
import { SynthesisPort } from "@embeddings/out-ports";
import { AnalysisResult, SessionSummary } from "@embeddings/dtos";
import { AnalysisIntent } from "@embeddings/value-objects/filter";
import { SessionCacheService } from "../infrastructure/cache/session-cache.service";
import {
  QueryReformulationService,
  ContextCompressionService,
} from "./preprocessing";
import { KeywordIntentClassifier } from "./classifiers";

/**
 * SearchService - Orchestrates query handling using Strategy Pattern.
 *
 * Responsibilities:
 * - Prepare query context (history, reformulation, metadata)
 * - Classify intent (hybrid LLM + keyword fallback)
 * - Delegate execution to the strategy for that intent
 */
@Injectable()
export class SearchService extends SearchUseCase {
  private readonly logger = new Logger(SearchService.name);

  private readonly strategyByIntent: Map<AnalysisIntent, QueryStrategy>;

  private readonly defaultStrategy: QueryStrategy;

  constructor(
    @Inject(QUERY_STRATEGIES)
    private readonly strategies: QueryStrategy[],
    private readonly keywordIntentClassifier: KeywordIntentClassifier,
    private readonly synthesisPort: SynthesisPort,
    private readonly sessionCache: SessionCacheService,
    private readonly queryReformulation: QueryReformulationService,
    private readonly contextCompression: ContextCompressionService,
  ) {
    super();

    this.strategyByIntent = new Map(
      strategies.map((s) => [s.intent, s] as const),
    );

    this.defaultStrategy =
      strategies.find((s) => s.intent === AnalysisIntent.SEMANTIC) ||
      strategies[0];

    this.logger.log(
      `Initialized with ${strategies.length} strategies: ${strategies.map((s) => s.intent).join(", ")}`,
    );
  }

  /**
   * Performs a full RAG (Retrieval-Augmented Generation) search.
   * @param query The user's natural language question.
   * @param sessionId The session ID for chat history.
   * @returns The analysis result containing the answer, confidence, and source.
   */
  async ask(
    query: string,
    sessionId?: string,
    clientId?: string,
  ): Promise<AnalysisResult> {
    this.logger.log(
      `Processing RAG query: "${query}" (Session: ${sessionId || "none"})`,
    );

    try {
      const history = await this.loadHistory(sessionId);

      if (this.keywordIntentClassifier.isConversationalKeywordMatch(query)) {
        const strategy = this.strategyByIntent.get(
          AnalysisIntent.CONVERSATIONAL,
        )!;
        this.logger.log(
          `Selected strategy: ${strategy.intent} (conversational keyword fast path)`,
        );
        const context = this.buildConversationalContext(
          query,
          history,
          sessionId,
          clientId,
        );
        return strategy.execute(context);
      }

      const context = await this.buildQueryContext(
        query,
        history,
        sessionId,
        clientId,
      );

      const strategy = this.resolveStrategy(context);
      this.logger.log(
        `Selected strategy: ${strategy.intent} (templateId=${context.templateId ?? 'null'})`,
      );

      return strategy.execute(context);
    } catch (error) {
      const err = error as Error;
      this.logger.error(`RAG process failed: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Retrieves chat history for a given session.
   */
  async getChatHistory(sessionId: string): Promise<AnalysisResult[]> {
    return this.sessionCache.getHistory(sessionId);
  }

  async listSessions(clientId: string): Promise<SessionSummary[]> {
    return this.sessionCache.listSessions(clientId);
  }

  async deleteSession(sessionId: string, clientId: string): Promise<boolean> {
    return this.sessionCache.deleteSession(sessionId, clientId);
  }

  private resolveStrategy(context: QueryContext): QueryStrategy {
    if (context.templateId) {
      const statistical = this.strategyByIntent.get(AnalysisIntent.STATISTICAL);
      if (statistical) return statistical;
    }
    return this.defaultStrategy;
  }

  /**
   * Load conversation history for a session.
   */
  private async loadHistory(sessionId?: string): Promise<AnalysisResult[]> {
    if (!sessionId) {
      return [];
    }

    const history = await this.sessionCache.getHistory(sessionId);
    this.logger.debug(
      `Retrieved ${history.length} history turns for session ${sessionId}`,
    );
    return history;
  }

  /**
   * Build context for conversational queries.
   * Simpler context - no reformulation or metadata extraction needed.
   */
  private buildConversationalContext(
    query: string,
    history: AnalysisResult[],
    sessionId?: string,
    clientId?: string,
  ): QueryContext {
    const targetLanguage = this.synthesisPort.detectLanguage(query);

    return {
      originalQuery: query,
      reformulatedQuery: query,
      isStandalone: true,
      metadata: {
        startTime: null,
        endTime: null,
        service: null,
        route: null,
        errorCode: null,
        hasError: false,
      },
      history,
      sessionId,
      clientId,
      targetLanguage,
    };
  }

  /**
   * Build full query context for semantic/statistical queries.
   * Includes reformulation, metadata extraction, and history compression.
   */
  private async buildQueryContext(
    query: string,
    history: AnalysisResult[],
    sessionId?: string,
    clientId?: string,
  ): Promise<QueryContext> {
    // 1. Detect original language
    const originalLanguage = this.synthesisPort.detectLanguage(query);

    // 2. Reformulate query with history context
    const reformulatedQuery = await this.queryReformulation.reformulateQuery(
      query,
      history,
    );

    // 3. Safe Guard: If reformulation translated the query, fallback to original
    const safeReformulatedQuery =
      this.synthesisPort.detectLanguage(reformulatedQuery) !== originalLanguage
        ? query
        : reformulatedQuery;

    if (safeReformulatedQuery !== reformulatedQuery) {
      this.logger.warn(
        `Reformulation translation detected! Falling back to original query to maintain language sovereignty.`,
      );
    }

    // 4. Detect if query is standalone
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

    // 5. Compress history if too long
    const compressedHistory =
      history.length > 10
        ? await this.contextCompression.compressHistory(history)
        : history;

    // 6. Classify intent and extract metadata in one LLM call
    const { templateId, params: templateParams, metadata } =
      await this.synthesisPort.classifyAndExtract(safeReformulatedQuery);

    this.logger.log(
      `classifyAndExtract: templateId=${templateId ?? 'null'}, metadata=${JSON.stringify(metadata)}`,
    );

    return {
      originalQuery: query,
      reformulatedQuery: safeReformulatedQuery,
      isStandalone,
      metadata,
      history: compressedHistory,
      sessionId,
      clientId,
      targetLanguage: originalLanguage,
      templateId: templateId ?? null,
      templateParams: templateId ? templateParams : undefined,
    };
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
}
