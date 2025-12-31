import { QueryMetadata } from "@embeddings/dtos";
import { AnalysisResult } from "@embeddings/domain";

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
}
