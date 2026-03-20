import { AnalysisResult, QueryMetadata } from '@embeddings/dtos';
import { AnalysisIntent } from '@embeddings/value-objects/filter';

export type IntentClassificationSource = 'LLM' | 'KEYWORD_FALLBACK';

export interface ClassificationResult {
  intent: AnalysisIntent;
  confidence: number;
  reasoning?: string;
  source: IntentClassificationSource;
}

/**
 * Classifies user intent for query routing.
 * Implementations may use LLM-derived metadata and/or keyword rules.
 */
export abstract class IntentClassifier {
  abstract classify(
    query: string,
    history: AnalysisResult[],
    metadata: QueryMetadata,
  ): Promise<ClassificationResult>;
}

export const INTENT_CLASSIFIER = Symbol('INTENT_CLASSIFIER');
