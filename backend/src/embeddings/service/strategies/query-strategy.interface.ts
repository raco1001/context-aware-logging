import { AnalysisResult, QueryMetadata } from '@embeddings/dtos';
import { AnalysisIntent } from '@embeddings/value-objects/filter';

/**
 * QueryContext - Shared context passed to all query strategies.
 * Contains preprocessed data needed for query execution.
 */
export interface QueryContext {
  /** Original user query */
  readonly originalQuery: string;

  /** Query reformulated with conversation history context */
  readonly reformulatedQuery: string;

  /** Whether the query is standalone (doesn't depend on history) */
  readonly isStandalone: boolean;

  /** Extracted metadata from the query */
  readonly metadata: QueryMetadata;

  /** Compressed conversation history */
  readonly history: AnalysisResult[];

  /** Session ID for cache management */
  readonly sessionId?: string;

  /** Detected language of the original query */
  readonly targetLanguage: 'Korean' | 'English';
}

/**
 * QueryStrategy - Interface for query handling strategies.
 *
 * Each strategy handles a specific type of query intent.
 * Strategies are selected based on canHandle() and executed via execute().
 *
 * Design principles:
 * - Single Responsibility: One strategy per intent type
 * - Open/Closed: Add new strategies without modifying existing code
 * - Dependency Inversion: Depend on abstractions (ports), not implementations
 */
export interface QueryStrategy {
  /**
   * The intent this strategy handles.
   */
  readonly intent: AnalysisIntent;

  /**
   * Priority for strategy selection (higher = checked first).
   * Useful when multiple strategies could handle the same query.
   */
  readonly priority: number;

  /**
   * Determine if this strategy can handle the given query.
   * Called during strategy selection phase.
   *
   * @param query - The user's query string
   * @param history - Conversation history (may influence intent detection)
   * @returns true if this strategy should handle the query
   */
  canHandle(query: string, history: AnalysisResult[]): boolean;

  /**
   * Execute the query handling logic.
   * Called after strategy selection.
   *
   * @param context - The preprocessed query context
   * @returns The analysis result
   */
  execute(context: QueryContext): Promise<AnalysisResult>;
}

/**
 * Injection token for query strategies array.
 */
export const QUERY_STRATEGIES = Symbol('QUERY_STRATEGIES');
