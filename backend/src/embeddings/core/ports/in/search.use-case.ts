import { AnalysisResult, SessionSummary } from '@embeddings/dtos';

export abstract class SearchUseCase {
  /**
   * Performs a full RAG (Retrieval-Augmented Generation) search.
   * 1. Search (Vector)
   * 2. Rerank
   * 3. Grounding (Fetch full logs)
   * 4. Synthesis (LLM Answer)
   */
  abstract ask(
    query: string,
    sessionId?: string,
    clientId?: string,
  ): Promise<AnalysisResult>;

  /**
   * Retrieves chat history for a given session.
   */
  abstract getChatHistory(sessionId: string): Promise<AnalysisResult[]>;

  /**
   * Lists sessions for the given client (requires client identity).
   */
  abstract listSessions(clientId: string): Promise<SessionSummary[]>;

  /**
   * Deletes a session for the given client (ownership enforced server-side).
   */
  abstract deleteSession(
    sessionId: string,
    clientId: string,
  ): Promise<boolean>;
}
