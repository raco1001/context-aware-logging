import { LogEmbeddingEntity } from '@embeddings/domain/index';
export abstract class EmbeddingUseCase {
  abstract processPendingLogs(limit: number): Promise<number>;

  /**
   * Manually trigger embedding for a specific request ID.
   * Useful for targeted testing or re-processing.
   */
  abstract embedByRequestId(requestId: string): Promise<void>;

  /**
   * Performs semantic search using vector similarity.
   */
  abstract search(query: string, limit?: number): Promise<any[]>;
}
