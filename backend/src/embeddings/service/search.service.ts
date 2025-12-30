import { Injectable, Logger } from "@nestjs/common";
import { SearchUseCase } from "@embeddings/in-ports";
import {
  EmbeddingPort,
  RerankPort,
  SynthesisPort,
  ChatHistoryPort,
  LogStoragePort,
} from "@embeddings/out-ports";
import { AnalysisResult, AnalysisIntent } from "@embeddings/domain";
import {
  SEMANTIC_KEYWORDS,
  STATISTIC_KEYWORDS,
} from "@embeddings/value-objects";

@Injectable()
export class SearchService extends SearchUseCase {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private readonly embeddingPort: EmbeddingPort,
    private readonly rerankPort: RerankPort,
    private readonly synthesisPort: SynthesisPort,
    private readonly chatHistoryPort: ChatHistoryPort,
    private readonly logStoragePort: LogStoragePort,
  ) {
    super();
  }

  /**
   * Performs a full RAG (Retrieval-Augmented Generation) search.
   * @param query The user's natural language question.
   * @param sessionId The session ID for chat history.
   * @returns The analysis result containing the answer, confidence, and source.
   */
  async ask(query: string, sessionId?: string): Promise<AnalysisResult> {
    this.logger.log(
      `Processing RAG query: "${query}" (Session: ${sessionId || "none"})`,
    );

    try {
      const metadata = await this.synthesisPort.extractMetadata(query);
      const intent = this.classifyIntent(query);
      this.logger.log(`Extracted metadata: ${JSON.stringify(metadata)}`);

      const { embedding } = await this.embeddingPort.createEmbedding(query);
      const vectorResults = await this.logStoragePort.vectorSearch(
        embedding,
        10,
        metadata,
      );

      if (!vectorResults || vectorResults.length === 0) {
        return this.createEmptyResult(query, intent, sessionId);
      }

      const documentsForRerank = vectorResults.map((res) => res.summary);
      const rerankedIndices = await this.rerankPort.rerank(
        query,
        documentsForRerank,
        5,
      );

      const topResults = rerankedIndices.map(
        (item) => vectorResults[item.index],
      );

      const eventIds = topResults.map((res) => res.eventId);

      let fullLogs = await this.logStoragePort.getLogsByEventIds(eventIds);

      // Post-filtering: Apply error-related filters after grounding
      if (metadata.hasError || metadata.errorCode) {
        fullLogs = fullLogs.filter((log) => {
          // If hasError is true, filter logs that have an error field
          if (metadata.hasError && !log.error) {
            return false;
          }
          // If errorCode is specified, match the error code
          if (metadata.errorCode && log.error?.code !== metadata.errorCode) {
            return false;
          }
          return true;
        });

        // If filtering removed all results, log a warning
        if (fullLogs.length === 0) {
          this.logger.warn(
            `Post-filtering removed all results. Original count: ${eventIds.length}, Filtered: 0`,
          );
        }
      }

      const requestIds = fullLogs.map((log) => log.requestId).filter(Boolean);

      const history = sessionId
        ? await this.chatHistoryPort.findBySessionId(sessionId)
        : [];

      const { answer, confidence } = await this.synthesisPort.synthesize(
        query,
        fullLogs,
        history,
      );

      const result: AnalysisResult = {
        question: query,
        intent,
        answer,
        sources: requestIds,
        confidence,
        sessionId,
      };

      if (sessionId) {
        await this.chatHistoryPort.save(result);
      }

      return result;
    } catch (error) {
      this.logger.error(`RAG process failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  async getChatHistory(sessionId: string): Promise<AnalysisResult[]> {
    return this.chatHistoryPort.findBySessionId(sessionId);
  }

  private classifyIntent(query: string): AnalysisIntent {
    const statisticalKeywords = STATISTIC_KEYWORDS;
    const semanticKeywords = SEMANTIC_KEYWORDS;

    if (statisticalKeywords.some((k) => query.toLowerCase().includes(k))) {
      return AnalysisIntent.STATISTICAL;
    } else if (semanticKeywords.some((k) => query.toLowerCase().includes(k))) {
      return AnalysisIntent.SEMANTIC;
    }

    return AnalysisIntent.UNKNOWN;
  }

  private createEmptyResult(
    question: string,
    intent: AnalysisIntent,
    sessionId?: string,
  ): AnalysisResult {
    return {
      question,
      intent,
      answer: "Not enough evidence.",
      sources: [],
      sessionId,
      confidence: 0,
    };
  }
}
