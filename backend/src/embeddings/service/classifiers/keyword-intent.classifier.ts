import { Injectable } from '@nestjs/common';
import { AnalysisResult, QueryMetadata } from '@embeddings/dtos';
import {
  AnalysisIntent,
  AGGREGATION_KEYWORDS,
  CONVERSATIONAL_KEYWORDS,
  SEMANTIC_KEYWORDS,
  STATISTIC_KEYWORDS,
} from '@embeddings/value-objects/filter';
import {
  ClassificationResult,
  IntentClassifier,
} from '@embeddings/in-ports';

/**
 * Keyword-only intent rules matching former QueryStrategy.canHandle priority:
 * conversational (100) → statistical (20) → semantic (10).
 * Unmatched queries return UNKNOWN (caller maps to default semantic strategy).
 */
@Injectable()
export class KeywordIntentClassifier extends IntentClassifier {
  isConversationalKeywordMatch(query: string): boolean {
    const lowerQuery = query.toLowerCase();
    return CONVERSATIONAL_KEYWORDS.some((k) => lowerQuery.includes(k));
  }

  private matchesStatistical(query: string): boolean {
    const lowerQuery = query.toLowerCase();
    return (
      AGGREGATION_KEYWORDS.some((k) => lowerQuery.includes(k)) ||
      STATISTIC_KEYWORDS.some((k) => lowerQuery.includes(k))
    );
  }

  private matchesSemantic(query: string): boolean {
    const lowerQuery = query.toLowerCase();
    return SEMANTIC_KEYWORDS.some((k) => lowerQuery.includes(k));
  }

  async classify(
    query: string,
    _history: AnalysisResult[],
    _metadata: QueryMetadata,
  ): Promise<ClassificationResult> {
    if (this.isConversationalKeywordMatch(query)) {
      return {
        intent: AnalysisIntent.CONVERSATIONAL,
        confidence: 1,
        source: 'KEYWORD_FALLBACK',
      };
    }
    if (this.matchesStatistical(query)) {
      return {
        intent: AnalysisIntent.STATISTICAL,
        confidence: 1,
        source: 'KEYWORD_FALLBACK',
      };
    }
    if (this.matchesSemantic(query)) {
      return {
        intent: AnalysisIntent.SEMANTIC,
        confidence: 1,
        source: 'KEYWORD_FALLBACK',
      };
    }
    return {
      intent: AnalysisIntent.UNKNOWN,
      confidence: 0,
      source: 'KEYWORD_FALLBACK',
    };
  }
}
