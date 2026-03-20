import { HybridIntentClassifier } from './hybrid-intent.classifier';
import { KeywordIntentClassifier } from './keyword-intent.classifier';
import { AnalysisIntent } from '@embeddings/value-objects/filter';
import { AnalysisResult, QueryMetadata } from '@embeddings/dtos';

const baseMeta: QueryMetadata = {
  startTime: null,
  endTime: null,
  service: null,
  route: null,
  errorCode: null,
  hasError: false,
};

describe('HybridIntentClassifier', () => {
  const keyword = new KeywordIntentClassifier();
  const hybrid = new HybridIntentClassifier(keyword);

  it('prefers confident LLM intent over misleading keyword (에러율 / 어떻게)', async () => {
    const metadata: QueryMetadata = {
      ...baseMeta,
      intent: AnalysisIntent.STATISTICAL,
      intentConfidence: 0.92,
    };
    const r = await hybrid.classify(
      '에러율이 어떻게 돼?',
      [] as AnalysisResult[],
      metadata,
    );
    expect(r.intent).toBe(AnalysisIntent.STATISTICAL);
    expect(r.source).toBe('LLM');
  });

  it('falls back to keyword when LLM confidence is low', async () => {
    const metadata: QueryMetadata = {
      ...baseMeta,
      intent: AnalysisIntent.STATISTICAL,
      intentConfidence: 0.5,
    };
    const r = await hybrid.classify(
      '에러율이 어떻게 돼?',
      [] as AnalysisResult[],
      metadata,
    );
    expect(r.source).toBe('KEYWORD_FALLBACK');
    expect(r.intent).toBe(AnalysisIntent.SEMANTIC);
  });
});
