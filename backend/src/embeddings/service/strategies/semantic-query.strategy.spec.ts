import { SemanticQueryStrategy } from './semantic-query.strategy';
import { AnalysisResult } from '@embeddings/dtos';
import { VectorSearchResult, RawLogDocument } from '@embeddings/domain';

describe('SemanticQueryStrategy (fallback & filter relaxation)', () => {
  const makeStrategy = (overrides?: {
    vectorResults?: VectorSearchResult[];
    fullLogs?: RawLogDocument[];
  }) => {
    const embeddingPort = {
      createEmbedding: jest.fn().mockResolvedValue({ embedding: [0.1, 0.2] }),
    } as any;

    const rerankPort = {
      rerank: jest.fn().mockResolvedValue([{ index: 0, relevance_score: 1 }]),
    } as any;

    const synthesisPort = {
      transformQueryToLogStyle: jest.fn().mockResolvedValue('log style'),
      synthesize: jest
        .fn()
        .mockResolvedValue({ answer: 'synthesized', confidence: 0.8 }),
      verifyGrounding: jest.fn().mockResolvedValue({
        status: 'VERIFIED',
        confidenceAdjustment: 1,
        unverifiedClaims: [],
        action: 'KEEP_ANSWER',
        reasoning: 'ok',
      }),
    } as any;

    const vectorResults: VectorSearchResult[] =
      overrides?.vectorResults ??
      ([
        {
          eventId: '507f1f77bcf86cd799439011',
          summary: 'summary 1',
          score: 0.9,
        },
      ] as VectorSearchResult[]);

    const logStoragePort = {
      vectorSearch: jest.fn().mockResolvedValue(vectorResults),
      getLogsByEventIds: jest.fn().mockResolvedValue(overrides?.fullLogs ?? []),
    } as any;

    const queryPreprocessor = {
      preprocessQuery: jest.fn().mockReturnValue('structured query'),
    } as any;

    const sessionCache = {
      updateSession: jest.fn().mockResolvedValue(undefined),
    } as any;

    const semanticCache = {
      getCachedResults: jest.fn().mockReturnValue(null),
      setCachedResults: jest.fn(),
    } as any;

    const strategy = new SemanticQueryStrategy(
      embeddingPort,
      rerankPort,
      synthesisPort,
      logStoragePort,
      queryPreprocessor,
      sessionCache,
      semanticCache,
    );

    return {
      strategy,
      embeddingPort,
      rerankPort,
      synthesisPort,
      logStoragePort,
      queryPreprocessor,
      sessionCache,
      semanticCache,
    };
  };

  it('relaxes errorCode (keep hasError) when post-filter removes all logs', async () => {
    const fullLogsBeforeFilter: RawLogDocument[] = [
      {
        _id: '507f1f77bcf86cd799439011',
        requestId: 'req-1',
        timestamp: new Date(),
        service: 'payments',
        route: 'POST /payments',
        error: { code: 'SOME_OTHER_CODE', message: 'boom' },
      },
    ];

    const { strategy, synthesisPort } = makeStrategy({
      fullLogs: fullLogsBeforeFilter,
    });

    const result = await strategy.execute({
      originalQuery: '왜 오류났어?',
      reformulatedQuery: '왜 오류났어?',
      isStandalone: true,
      metadata: {
        startTime: null,
        endTime: null,
        service: null,
        route: null,
        hasError: true,
        errorCode: 'TARGET_CODE',
      },
      history: [] as AnalysisResult[],
      sessionId: 's1',
      targetLanguage: 'Korean',
    });

    expect(synthesisPort.synthesize).toHaveBeenCalled();
    const synthesizeArgs = (synthesisPort.synthesize as jest.Mock).mock.calls[0];
    const contexts = synthesizeArgs[1] as RawLogDocument[];
    expect(contexts.length).toBe(1);
    expect(result.sources).toEqual(['req-1']);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('returns deterministic response when no logs remain after relaxation', async () => {
    const { strategy, synthesisPort, sessionCache } = makeStrategy({
      fullLogs: [],
    });

    const result = await strategy.execute({
      originalQuery: '오류가 있었어?',
      reformulatedQuery: '오류가 있었어?',
      isStandalone: true,
      metadata: {
        startTime: null,
        endTime: null,
        service: null,
        route: null,
        hasError: true,
        errorCode: 'SOME_CODE',
      },
      history: [] as AnalysisResult[],
      sessionId: 's2',
      targetLanguage: 'Korean',
    });

    expect(synthesisPort.synthesize).not.toHaveBeenCalled();
    expect(result.sources).toEqual([]);
    expect(result.confidence).toBe(0);
    expect(typeof result.answer).toBe('string');
    expect(sessionCache.updateSession).toHaveBeenCalled();
  });
});

