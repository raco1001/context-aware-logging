import { Injectable, Logger } from "@nestjs/common";
import { ChatHistoryPort } from "@embeddings/out-ports";
import { AnalysisResult } from "@embeddings/dtos";
import { AnalysisIntent } from "@embeddings/value-objects/filter";
import { MongoEmbeddingClient } from "./mongo.client";

@Injectable()
export class MongoChatHistoryAdapter extends ChatHistoryPort {
  private readonly logger = new Logger(MongoChatHistoryAdapter.name);
  private readonly historyCollection = "chat_history";

  constructor(private readonly client: MongoEmbeddingClient) {
    super();
  }

  async save(result: AnalysisResult): Promise<void> {
    try {
      const collection = this.client.getCollection(this.historyCollection);
      await collection.insertOne({
        ...result,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } catch (error) {
      this.logger.error(`Failed to save chat history: ${error.message}`);
    }
  }

  async findBySessionId(sessionId: string): Promise<AnalysisResult[]> {
    try {
      const collection = this.client.getCollection(this.historyCollection);
      const docs = await collection
        .find({ sessionId })
        .sort({ createdAt: 1 })
        .toArray();

      return docs.map((doc) => ({
        question: doc.question,
        intent: doc.intent as AnalysisIntent,
        answer: doc.answer,
        sources: doc.sources || [],
        confidence: doc.confidence,
        sessionId: doc.sessionId,
        createdAt: doc.createdAt,
      }));
    } catch (error) {
      this.logger.error(
        `Failed to find chat history for session ${sessionId}: ${error.message}`,
      );
      return [];
    }
  }
}
