import { Injectable, Logger } from "@nestjs/common";
import { EmbeddingPort, RerankPort } from "@embeddings/out-ports";
import { EmbeddingResult } from "@embeddings/domain";
import { VoyageClient } from "./voyage.client";

/**
 * VoyageAdapter - Adapter that performs actual Voyage AI API operations
 * using the initialized client from VoyageClient.
 */
@Injectable()
export class VoyageAdapter extends EmbeddingPort implements RerankPort {
  private readonly logger = new Logger(VoyageAdapter.name);

  constructor(private readonly voyageClient: VoyageClient) {
    super();
  }

  async createEmbedding(text: string): Promise<EmbeddingResult> {
    try {
      const client = this.voyageClient.getClient();
      const model = this.voyageClient.getModelName();

      const response = await client.embed({
        input: [text],
        model: model,
      });

      if (
        !response.data ||
        !response.data[0] ||
        !response.model ||
        !response.usage
      ) {
        throw new Error("Invalid response from Voyage AI API");
      }

      const firstItem = response.data[0];
      if (!firstItem.embedding || !response.usage.totalTokens) {
        throw new Error("Invalid embedding data in response");
      }

      return {
        embedding: firstItem.embedding,
        model: response.model,
        usage: {
          totalTokens: response.usage.totalTokens,
        },
      };
    } catch (error) {
      this.logger.error(`Embedding generation failed: ${error.message}`);
      throw error;
    }
  }

  async createBatchEmbeddings(texts: string[]): Promise<EmbeddingResult[]> {
    try {
      const client = this.voyageClient.getClient();
      const model = this.voyageClient.getModelName();

      const response = await client.embed({
        input: texts,
        model: model,
      });

      if (!response.data || !response.model || !response.usage) {
        throw new Error("Invalid response from Voyage AI API");
      }

      const modelName = response.model;
      const totalTokens = response.usage.totalTokens;

      if (totalTokens === undefined || totalTokens === null) {
        throw new Error("Total tokens not found in response");
      }

      return response.data.map((item: any) => {
        if (!item.embedding) {
          throw new Error("Invalid embedding data in batch response");
        }
        return {
          embedding: item.embedding,
          model: modelName,
          usage: {
            totalTokens: totalTokens / texts.length,
          },
        };
      });
    } catch (error) {
      this.logger.error(`Batch embedding generation failed: ${error.message}`);
      throw error;
    }
  }

  async rerank(
    query: string,
    documents: string[],
    limit: number = 5,
  ): Promise<{ index: number; relevance_score: number }[]> {
    try {
      const client = this.voyageClient.getClient();

      const response = await client.rerank({
        query,
        documents,
        model: "rerank-2",
        topK: limit,
      });

      if (!response.data) {
        throw new Error("Invalid response from Voyage AI Rerank API");
      }

      return response.data.map((item: any) => ({
        index: item.index,
        relevance_score: item.relevanceScore,
      }));
    } catch (error) {
      this.logger.error(`Reranking failed: ${error.message}`);
      throw error;
    }
  }
}
