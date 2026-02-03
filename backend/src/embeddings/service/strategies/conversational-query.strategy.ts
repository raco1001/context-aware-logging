import { Injectable, Logger } from '@nestjs/common';
import { SynthesisPort } from '@embeddings/out-ports';
import { AnalysisResult } from '@embeddings/dtos';
import {
  AnalysisIntent,
  CONVERSATIONAL_KEYWORDS,
} from '@embeddings/value-objects/filter';
import { SessionCacheService } from '@embeddings/service/sub-services';
import { QueryStrategy, QueryContext } from './query-strategy.interface';

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
  readonly priority = 100; // Highest priority - check first

  constructor(
    private readonly synthesisPort: SynthesisPort,
    private readonly sessionCache: SessionCacheService,
  ) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  canHandle(query: string, _history: AnalysisResult[]): boolean {
    const lowerQuery = query.toLowerCase();
    return CONVERSATIONAL_KEYWORDS.some((k) => lowerQuery.includes(k));
  }

  async execute(context: QueryContext): Promise<AnalysisResult> {
    const { originalQuery, history, sessionId, targetLanguage } = context;

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
        createdAt: new Date(),
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
      createdAt: new Date(),
    };

    if (sessionId) {
      await this.sessionCache.updateSession(sessionId, result);
    }

    return result;
  }
}
