import { Injectable, Logger } from '@nestjs/common';
import { ChatHistoryPort } from '@embeddings/out-ports';
import { AnalysisResult, SessionSummary } from '@embeddings/dtos';
import { AnalysisIntent } from '@embeddings/value-objects/filter';
import { MongoEmbeddingClient } from './mongo.client';

@Injectable()
export class MongoChatHistoryAdapter extends ChatHistoryPort {
  private readonly logger = new Logger(MongoChatHistoryAdapter.name);
  private readonly historyCollection = 'chat_history';

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
        clientId: doc.clientId,
        title: doc.title,
        createdAt: doc.createdAt,
      }));
    } catch (error) {
      this.logger.error(
        `Failed to find chat history for session ${sessionId}: ${error.message}`,
      );
      return [];
    }
  }

  async listSessions(clientId?: string): Promise<SessionSummary[]> {
    try {
      const collection = this.client.getCollection(this.historyCollection);
      const matchStage = clientId ? [{ $match: { clientId } }] : [];

      const rows = await collection
        .aggregate([
          ...matchStage,
          { $sort: { createdAt: 1 } },
          {
            $group: {
              _id: '$sessionId',
              title: {
                $first: {
                  $ifNull: [
                    '$title',
                    { $substrCP: ['$question', 0, 50] },
                  ],
                },
              },
              lastMessage: {
                $last: { $substrCP: ['$answer', 0, 100] },
              },
              messageCount: { $sum: 1 },
              createdAt: { $first: '$createdAt' },
              updatedAt: { $last: '$createdAt' },
              clientId: { $first: '$clientId' },
            },
          },
          { $match: { messageCount: { $gt: 0 } } },
          { $sort: { updatedAt: -1 } },
          { $limit: 50 },
        ])
        .toArray();

      return rows.map((row) => {
        const createdAt = row.createdAt as Date | undefined;
        const updatedAt = row.updatedAt as Date | undefined;
        return {
          sessionId: String(row._id),
          clientId: row.clientId,
          title: String(row.title ?? ''),
          lastMessage: String(row.lastMessage ?? ''),
          messageCount: Number(row.messageCount ?? 0),
          createdAt: createdAt?.toISOString?.() ?? '',
          updatedAt: updatedAt?.toISOString?.() ?? '',
        };
      });
    } catch (error) {
      this.logger.error(`Failed to list sessions: ${error.message}`);
      return [];
    }
  }

  async deleteSession(sessionId: string, clientId: string): Promise<boolean> {
    if (!sessionId || !clientId) {
      return false;
    }
    try {
      const collection = this.client.getCollection(this.historyCollection);
      const result = await collection.deleteMany({ sessionId, clientId });
      return result.deletedCount > 0;
    } catch (error) {
      this.logger.error(`Failed to delete session ${sessionId}: ${error.message}`);
      return false;
    }
  }
}
