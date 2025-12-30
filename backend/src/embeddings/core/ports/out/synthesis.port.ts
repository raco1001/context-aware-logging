import { QueryMetadata } from "@embeddings/dtos";

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
}
