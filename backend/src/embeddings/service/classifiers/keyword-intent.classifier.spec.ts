import { KeywordIntentClassifier } from './keyword-intent.classifier';

describe('KeywordIntentClassifier', () => {
  const classifier = new KeywordIntentClassifier();

  it('returns true for conversational keywords', () => {
    expect(classifier.isConversationalKeywordMatch('이전 대화 요약해줘')).toBe(true);
    expect(classifier.isConversationalKeywordMatch('요약해줘')).toBe(true);
    expect(classifier.isConversationalKeywordMatch('방금 한 말이 뭐야')).toBe(true);
  });

  it('returns false for non-conversational queries', () => {
    expect(classifier.isConversationalKeywordMatch('에러율이 어떻게 돼?')).toBe(false);
    expect(classifier.isConversationalKeywordMatch('결제 실패 원인 알려줘')).toBe(false);
    expect(classifier.isConversationalKeywordMatch('최근 24시간 오류 건수')).toBe(false);
  });
});
