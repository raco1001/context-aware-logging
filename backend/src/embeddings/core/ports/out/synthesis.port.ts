import { QueryMetadata } from '@embeddings/dtos';
import { AnalysisResult } from '@embeddings/dtos';

export abstract class SynthesisPort {
  /**
   * Extracts metadata (time range, service, etc.) from a natural language query.
   */
  abstract extractMetadata(query: string): Promise<QueryMetadata>;

  /**
   * Synthesizes a natural language answer based on the provided context.
   */
  abstract synthesize(
    query: string,
    contexts: any[],
    history?: any[],
    targetLanguage?: 'Korean' | 'English',
  ): Promise<{ answer: string; confidence: number }>;

  /**
   * Reformulates a query by resolving references based on chat history.
   * Used for conversational RAG to handle pronouns and ambiguous references.
   *
   * @param query The original query that may contain references
   * @param history Chat history to resolve references from
   * @returns Reformulated query with resolved references
   */
  abstract reformulateQuery(
    query: string,
    history: AnalysisResult[],
  ): Promise<string>;

  /**
   * Summarizes conversation history into a concise summary.
   * Used for context compression to reduce token usage while preserving important context.
   *
   * @param history Chat history to summarize
   * @returns Concise summary of the conversation history
   */
  abstract summarizeHistory(history: AnalysisResult[]): Promise<string>;

  /**
   * Analyzes a natural language query for statistical intent and extracts parameters.
   *
   * @param query The natural language query
   * @param initialMetadata Optional initial metadata extracted from the query (to avoid re-extraction)
   * @returns The selected template ID and parameters
   */
  abstract analyzeStatisticalQuery(
    query: string,
    initialMetadata?: QueryMetadata,
  ): Promise<{ templateId: string; params: Record<string, any> }>;

  /**
   * Verifies that a generated answer is strictly supported by the grounding context.
   * This prevents hallucinations by fact-checking the answer against the provided logs.
   *
   * @param query The original query
   * @param answer The generated answer to verify
   * @param groundingContext The log contexts used to generate the answer
   * @returns Verification result with status, confidence adjustment, and unverified claims
   */
  abstract verifyGrounding(
    query: string,
    answer: string,
    groundingContext: any[],
  ): Promise<{
    status: 'VERIFIED' | 'PARTIALLY_VERIFIED' | 'NOT_VERIFIED';
    confidenceAdjustment: number;
    unverifiedClaims: string[];
    action: 'KEEP_ANSWER' | 'ADJUST_CONFIDENCE' | 'REJECT_ANSWER';
    reasoning: string;
  }>;

  /**
   * Transforms a natural language query into a hypothetical log-style narrative.
   * This implements a HyDE-like strategy to improve semantic matching with log summaries.
   *
   * @param query The original natural language query
   * @returns A log-style narrative that hypothetical logs would have
   */
  abstract transformQueryToLogStyle(query: string): Promise<string>;

  /**
   * Detects the language of a text string.
   * @param text The text to detect language for
   * @returns "Korean" or "English"
   */
  abstract detectLanguage(text: string): 'Korean' | 'English';
}
