import { Injectable, Logger } from '@nestjs/common';
import { AnalysisResult, QueryMetadata } from '@embeddings/dtos';
import {
  ClassificationResult,
  IntentClassifier,
} from '@embeddings/in-ports';
import { KeywordIntentClassifier } from './keyword-intent.classifier';

const CONFIDENCE_THRESHOLD = 0.7;

/**
 * Uses LLM-derived intent from QueryMetadata when present and confident enough;
 * otherwise delegates to {@link KeywordIntentClassifier}.
 */
@Injectable()
export class HybridIntentClassifier extends IntentClassifier {
  private readonly logger = new Logger(HybridIntentClassifier.name);

  constructor(private readonly keywordClassifier: KeywordIntentClassifier) {
    super();
  }

  async classify(
    query: string,
    history: AnalysisResult[],
    metadata: QueryMetadata,
  ): Promise<ClassificationResult> {
    const llmIntent = metadata.intent;
    const llmConf = metadata.intentConfidence;
    if (
      llmIntent !== undefined &&
      llmConf !== undefined &&
      llmConf >= CONFIDENCE_THRESHOLD
    ) {
      this.logger.log(
        `Intent classification: LLM → ${llmIntent} (confidence=${llmConf})`,
      );
      return {
        intent: llmIntent,
        confidence: llmConf,
        source: 'LLM',
      };
    }

    const fallback = await this.keywordClassifier.classify(
      query,
      history,
      metadata,
    );
    this.logger.log(
      `Intent classification: KEYWORD_FALLBACK → ${fallback.intent}` +
        (llmIntent !== undefined
          ? ` (LLM suggested ${llmIntent}, conf=${llmConf ?? 'n/a'})`
          : ''),
    );
    return fallback;
  }
}
