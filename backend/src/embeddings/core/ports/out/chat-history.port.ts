import { AnalysisResult, SessionSummary } from '@embeddings/dtos';

export abstract class ChatHistoryPort {
  /**
   * Saves a chat interaction to history.
   */
  abstract save(result: AnalysisResult): Promise<void>;

  /**
   * Retrieves chat interactions for a session.
   */
  abstract findBySessionId(sessionId: string): Promise<AnalysisResult[]>;

  /**
   * Lists session summaries for a client, or all sessions if clientId is omitted (internal/testing).
   */
  abstract listSessions(clientId?: string): Promise<SessionSummary[]>;

  /**
   * Deletes all chat turns for a session owned by the given client.
   */
  abstract deleteSession(sessionId: string, clientId: string): Promise<boolean>;
}
