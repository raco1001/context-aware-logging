import { KeywordIntentClassifier } from './keyword-intent.classifier';
import { AnalysisIntent } from '@embeddings/value-objects/filter';
import { AnalysisResult } from '@embeddings/dtos';

const emptyMeta = {
  startTime: null,
  endTime: null,
  service: null,
  route: null,
  errorCode: null,
  hasError: false,
};

describe('KeywordIntentClassifier', () => {
  const classifier = new KeywordIntentClassifier();

  it('matches conversational before statistical/semantic', async () => {
    const r = await classifier.classify(
      '이전 대화 요약해줘',
      [] as AnalysisResult[],
      emptyMeta,
    );
    expect(r.intent).toBe(AnalysisIntent.CONVERSATIONAL);
    expect(r.source).toBe('KEYWORD_FALLBACK');
  });

  it('classifies 에러율 question as SEMANTIC on keywords alone (어떻게); hybrid LLM corrects to STATISTICAL', async () => {
    const r = await classifier.classify(
      '에러율이 어떻게 돼?',
      [] as AnalysisResult[],
      emptyMeta,
    );
    expect(r.intent).toBe(AnalysisIntent.SEMANTIC);
  });

  it('classifies 왜-style questions as SEMANTIC when semantic keywords hit', async () => {
    const r = await classifier.classify(
      '왜 오류가 났어?',
      [] as AnalysisResult[],
      emptyMeta,
    );
    expect(r.intent).toBe(AnalysisIntent.SEMANTIC);
  });

  it('exposes conversational keyword fast path', () => {
    expect(classifier.isConversationalKeywordMatch('요약해줘')).toBe(true);
    expect(classifier.isConversationalKeywordMatch('에러율이 어떻게 돼?')).toBe(
      false,
    );
  });
});
