import { EmbeddingResult } from '@embeddings/domain';

/**
 * Outbound port for the embedding model (e.g., Voyage AI).
 */
export abstract class EmbeddingPort {
  /**
   * Generates an embedding for the given text.
   */
  abstract createEmbedding(text: string): Promise<EmbeddingResult>;

  /**
   * Generates embeddings for a batch of texts.
   */
  abstract createBatchEmbeddings(texts: string[]): Promise<EmbeddingResult[]>;
}
