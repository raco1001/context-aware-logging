import { Injectable, Logger } from '@nestjs/common';
import { SynthesisPort } from '@embeddings/out-ports';
import { AnalysisResult } from '@embeddings/dtos';
import { AnalysisIntent } from '@embeddings/value-objects/filter';
import { SessionCacheService } from '../../infrastructure/cache/session-cache.service';
import { QueryStrategy, QueryContext } from '@embeddings/in-ports';

/**
 * ConversationalQueryStrategy - Handles queries about the conversation itself.
 *
 * Examples:
 * - "What did we discuss earlier?"
 * - "Summarize our conversation"
 * - "What was my first question?"
 *
 * This strategy doesn't perform vector search; it works directly with
 * the conversation history.
 */
@Injectable()
export class ConversationalQueryStrategy implements QueryStrategy {
  private readonly logger = new Logger(ConversationalQueryStrategy.name);

  readonly intent = AnalysisIntent.CONVERSATIONAL;

  constructor(
    private readonly synthesisPort: SynthesisPort,
    private readonly sessionCache: SessionCacheService,
  ) {}

  async execute(context: QueryContext): Promise<AnalysisResult> {
    const { originalQuery, history, sessionId, clientId, targetLanguage } =
      context;

    this.logger.log(
      `Executing conversational query strategy for: "${originalQuery}"`,
    );

    // If history is empty, provide a default response
    if (history.length === 0) {
      const noHistoryAnswer =
        targetLanguage === 'Korean'
          ? '이 세션에서 이전에 나눈 대화 내용이 없습니다.'
          : "I don't have any previous conversation records in this session.";

      return {
        question: originalQuery,
        intent: this.intent,
        answer: noHistoryAnswer,
        sources: [],
        confidence: 1,
        sessionId,
        viewType: 'chat',
        createdAt: new Date().toISOString(),
      };
    }

    // For conversational intent, use the most recent 10 raw messages for accuracy
    // No need to compress as we are only looking at metadata about the conversation itself.
    const recentHistory = history.slice(-10);

    const { answer, confidence } = await this.synthesisPort.synthesize(
      originalQuery,
      [], // No logs needed for conversational queries
      recentHistory,
      targetLanguage,
    );

    const result: AnalysisResult = {
      question: originalQuery,
      intent: this.intent,
      answer,
      sources: [],
      confidence,
      sessionId,
      viewType: 'chat',
      createdAt: new Date().toISOString(),
    };

    if (sessionId) {
      await this.sessionCache.updateSession(sessionId, result, clientId);
    }

    return result;
  }
}
