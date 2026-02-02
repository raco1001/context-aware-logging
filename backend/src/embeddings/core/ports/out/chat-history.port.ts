import { AnalysisResult } from '@embeddings/dtos';

export abstract class ChatHistoryPort {
  /**
   * Saves a chat interaction to history.
   */
  abstract save(result: AnalysisResult): Promise<void>;

  /**
   * Retrieves chat interactions for a session.
   */
  abstract findBySessionId(sessionId: string): Promise<AnalysisResult[]>;
}
