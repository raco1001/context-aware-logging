import { EmbeddingStatus } from "@logging/value-objects";

/**
 * Result of an embedding operation.
 */
export interface EmbeddingResult {
  embedding: number[];
  model: string;
  usage: {
    totalTokens: number;
  };
}

/**
 * Domain entity representing the embedding state of a log.
 */
export class LogEmbeddingEntity {
  constructor(
    public readonly internalId: any, // MongoDB _id
    public readonly requestId: string,
    public readonly timestamp: Date,
    public readonly summary: string,
    public readonly status: EmbeddingStatus,
    public readonly service?: string,
    public readonly model?: string,
    public readonly embedding?: number[],
  ) {}

  /**
   * Check if the log is ready for embedding.
   */
  canBeEmbedded(): boolean {
    return !!this.summary;
  }
}
