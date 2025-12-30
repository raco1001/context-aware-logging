import { Injectable, Logger } from "@nestjs/common";
import { ChatHistoryPort } from "@embeddings/out-ports";
import { AnalysisResult, AnalysisIntent } from "@embeddings/domain";
import { MongoEmbeddingConnection } from "./mongo.client";

@Injectable()
export class MongoSearchAdapter extends ChatHistoryPort {
  private readonly logger = new Logger(MongoSearchAdapter.name);
  private readonly historyCollection = "chat_history";
  private readonly logsCollection = "wide_events";

  constructor(private readonly connection: MongoEmbeddingConnection) {
    super();
  }

  async save(result: AnalysisResult): Promise<void> {
    try {
      const collection = this.connection.getCollection(this.historyCollection);
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
      const collection = this.connection.getCollection(this.historyCollection);
      const docs = await collection
        .find({ sessionId })
        .sort({ createdAt: 1 })
        .toArray();

      return docs.map((doc) => ({
        question: doc.question,
        intent: doc.intent as AnalysisIntent,
        answer: doc.answer,
        sources: doc.sources || (doc.source ? [doc.source] : []),
        confidence: doc.confidence,
        sessionId: doc.sessionId,
      }));
    } catch (error) {
      this.logger.error(
        `Failed to find chat history for session ${sessionId}: ${error.message}`,
      );
      return [];
    }
  }

  /**
   * Grounding: Fetch full log documents by their request IDs.
   */
  async findLogsByRequestIds(requestIds: string[]): Promise<any[]> {
    try {
      const collection = this.connection.getCollection(this.logsCollection);
      return await collection
        .find({ requestId: { $in: requestIds } })
        .toArray();
    } catch (error) {
      this.logger.error(`Failed to find logs by requestIds: ${error.message}`);
      throw error;
    }
  }
}
