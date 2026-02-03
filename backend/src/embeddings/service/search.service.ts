import { Injectable, Logger, Inject } from '@nestjs/common';
import { SearchUseCase } from '@embeddings/in-ports';
import { SynthesisPort } from '@embeddings/out-ports';
import { AnalysisResult } from '@embeddings/dtos';
import { AnalysisIntent } from '@embeddings/value-objects/filter';
import {
  SessionCacheService,
  QueryReformulationService,
  ContextCompressionService,
} from '@embeddings/service/sub-services';
import { QueryStrategy, QueryContext, QUERY_STRATEGIES } from './strategies';

/**
 * SearchService - Orchestrates query handling using Strategy Pattern.
 *
 * Responsibilities:
 * - Prepare query context (history, reformulation, metadata)
 * - Select appropriate strategy based on query intent
 * - Delegate execution to the selected strategy
 *
 * This design follows Open/Closed Principle:
 * - New intent types can be added by creating new strategy classes
 * - No modification to SearchService required for new intents
 */
@Injectable()
export class SearchService extends SearchUseCase {
  private readonly logger = new Logger(SearchService.name);

  /** Strategies sorted by priority (highest first) */
  private readonly sortedStrategies: QueryStrategy[];

  /** Default strategy for unknown intents */
  private readonly defaultStrategy: QueryStrategy;

  constructor(
    @Inject(QUERY_STRATEGIES)
    private readonly strategies: QueryStrategy[],
    private readonly synthesisPort: SynthesisPort,
    private readonly sessionCache: SessionCacheService,
    private readonly queryReformulation: QueryReformulationService,
    private readonly contextCompression: ContextCompressionService,
  ) {
    super();

    // Sort strategies by priority (highest first)
    this.sortedStrategies = [...strategies].sort(
      (a, b) => b.priority - a.priority,
    );

    // Find semantic strategy as default (for UNKNOWN intent)
    this.defaultStrategy =
      strategies.find((s) => s.intent === AnalysisIntent.SEMANTIC) ||
      strategies[0];

    this.logger.log(
      `Initialized with ${strategies.length} strategies: ${strategies.map((s) => s.intent).join(', ')}`,
    );
  }

  /**
   * Performs a full RAG (Retrieval-Augmented Generation) search.
   * @param query The user's natural language question.
   * @param sessionId The session ID for chat history.
   * @returns The analysis result containing the answer, confidence, and source.
   */
  async ask(query: string, sessionId?: string): Promise<AnalysisResult> {
    this.logger.log(
      `Processing RAG query: "${query}" (Session: ${sessionId || 'none'})`,
    );

    try {
      // 1. Load conversation history
      const history = await this.loadHistory(sessionId);

      // 2. Select strategy based on query content
      const strategy = this.selectStrategy(query, history);
      this.logger.log(`Selected strategy: ${strategy.intent}`);

      // 3. Handle conversational queries early (no reformulation needed)
      if (strategy.intent === AnalysisIntent.CONVERSATIONAL) {
        const context = this.buildConversationalContext(
          query,
          history,
          sessionId,
        );
        return strategy.execute(context);
      }

      // 4. Build full context for other strategies
      const context = await this.buildQueryContext(query, history, sessionId);

      // 5. Execute selected strategy
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

  /**
   * Select the appropriate strategy for the query.
   * Strategies are checked in priority order.
   */
  private selectStrategy(
    query: string,
    history: AnalysisResult[],
  ): QueryStrategy {
    for (const strategy of this.sortedStrategies) {
      if (strategy.canHandle(query, history)) {
        return strategy;
      }
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

    // 6. Extract metadata from reformulated query
    const metadata = await this.synthesisPort.extractMetadata(
      safeReformulatedQuery,
    );

    this.logger.log(
      `Extracted metadata from reformulated query: ${JSON.stringify(metadata)}`,
    );

    return {
      originalQuery: query,
      reformulatedQuery: safeReformulatedQuery,
      isStandalone,
      metadata,
      history: compressedHistory,
      sessionId,
      targetLanguage: originalLanguage,
    };
  }

  /**
   * Detects if a query is standalone or depends on history.
   * If reformulated query is essentially the same as original, it's likely standalone.
   */
  private isStandaloneQuery(original: string, reformulated: string): boolean {
    const normOriginal = original.toLowerCase().trim().replace(/[?.!]/g, '');
    const normReformulated = reformulated
      .toLowerCase()
      .trim()
      .replace(/[?.!]/g, '');

    // If they are very similar, consider it standalone
    return (
      normOriginal === normReformulated ||
      normReformulated.includes(normOriginal) ||
      normOriginal.length / normReformulated.length > 0.8
    );
  }
}
