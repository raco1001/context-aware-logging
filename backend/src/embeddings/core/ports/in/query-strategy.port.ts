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

  /** Optional X-Client-Id for persistence */
  readonly clientId?: string;

  /** Detected language of the original query */
  readonly targetLanguage: 'Korean' | 'English';
}

/**
 * QueryStrategy - Interface for query handling strategies.
 *
 * Each strategy handles a specific type of query intent.
 * Strategies are selected by intent (see IntentClassifier) and executed via execute().
 */
export interface QueryStrategy {
  readonly intent: AnalysisIntent;

  execute(context: QueryContext): Promise<AnalysisResult>;
}

/**
 * Injection token for query strategies array.
 */
export const QUERY_STRATEGIES = Symbol('QUERY_STRATEGIES');
