export abstract class RerankPort {
  /**
   * Re-ranks a list of documents based on their relevance to a query.
   */
  abstract rerank(
    query: string,
    documents: string[],
    limit?: number,
  ): Promise<{ index: number; relevance_score: number }[]>;
}

