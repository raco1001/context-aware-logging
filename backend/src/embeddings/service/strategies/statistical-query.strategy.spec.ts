import { StatisticalQueryStrategy } from './statistical-query.strategy';
import { AnalysisResult } from '@embeddings/dtos';

describe('StatisticalQueryStrategy (stats payload mapping)', () => {
  const makeStrategy = (aggregationResults: any[]) => {
    const embeddingPort = {
      createEmbedding: jest.fn().mockResolvedValue({ embedding: [0.1, 0.2] }),
    } as any;

    const synthesisPort = {
      analyzeStatisticalQuery: jest.fn().mockResolvedValue({
        templateId: 'MIXED',
        params: {},
      }),
      transformQueryToLogStyle: jest.fn().mockResolvedValue('log style'),
      synthesize: jest
        .fn()
        .mockResolvedValue({ answer: 'stat answer', confidence: 0.9 }),
      verifyGrounding: jest.fn().mockResolvedValue({
        status: 'VERIFIED',
        confidenceAdjustment: 1,
        unverifiedClaims: [],
        action: 'KEEP_ANSWER',
        reasoning: 'ok',
      }),
    } as any;

    const logStoragePort = {
      vectorSearch: jest.fn().mockResolvedValue([]),
    } as any;

    const queryPreprocessor = {
      preprocessQuery: jest.fn().mockReturnValue('structured query'),
    } as any;

    const aggregation = {
      executeTemplate: jest.fn().mockResolvedValue(aggregationResults),
    } as any;

    const sessionCache = {
      updateSession: jest.fn().mockResolvedValue(undefined),
    } as any;

    const semanticCache = {
      getCachedResults: jest.fn().mockReturnValue(null),
      setCachedResults: jest.fn(),
    } as any;

    const strategy = new StatisticalQueryStrategy(
      embeddingPort,
      synthesisPort,
      logStoragePort,
      queryPreprocessor,
      aggregation,
      sessionCache,
      semanticCache,
    );

    return { strategy, sessionCache };
  };

  it('maps overview, routes and sources into typed contracts', async () => {
    const { strategy } = makeStrategy([
      {
        totalCount: 100,
        errorCount: 20,
        errorRate: 0.2,
      },
      {
        count: 100,
        p50: 45,
        p95: 120,
        p99: 300,
        avg: 70,
        max: 500,
      },
      {
        route: 'POST /payments',
        count: 8,
      },
      {
        errorCode: 'PAY_500',
        count: 4,
        examples: [
          {
            requestId: 'req-1',
            timestamp: '2026-03-19T00:00:00.000Z',
            route: 'POST /payments',
            errorCode: 'PAY_500',
            errorMessage: 'gateway timeout',
            failedAt: 'gateway',
          },
        ],
      },
    ]);

    const result = await strategy.execute({
      originalQuery: '에러율이 어떻게 돼?',
      reformulatedQuery: '에러율이 어떻게 돼?',
      isStandalone: true,
      metadata: {
        startTime: null,
        endTime: null,
        service: null,
        route: null,
        errorCode: null,
        hasError: false,
      },
      history: [] as AnalysisResult[],
      sessionId: 's1',
      targetLanguage: 'Korean',
    });

    expect(result.statsPayload?.overview).toEqual({
      totalRequests: 100,
      failedRequests: 20,
      successRate: 0.8,
      averageDurationMs: 70,
    });
    expect(result.statsPayload?.routes).toEqual([
      {
        route: 'POST /payments',
        failed: 8,
      },
    ]);
    expect(result.sources).toEqual([
      {
        id: 'req-1',
        summary: 'gateway timeout',
        status: 'FAILED',
        route: 'POST /payments',
        duration: 0,
        timestamp: '2026-03-19T00:00:00.000Z',
        errorCode: 'PAY_500',
        failedAt: 'gateway',
      },
    ]);
    expect(typeof result.createdAt).toBe('string');
  });

  it('keeps stats fields undefined when no mappable rows exist', async () => {
    const { strategy } = makeStrategy([{ errorCode: 'PAY_404', count: 1 }]);

    const result = await strategy.execute({
      originalQuery: '통계 보여줘',
      reformulatedQuery: '통계 보여줘',
      isStandalone: true,
      metadata: {
        startTime: null,
        endTime: null,
        service: null,
        route: null,
        errorCode: null,
        hasError: false,
      },
      history: [] as AnalysisResult[],
      sessionId: 's2',
      targetLanguage: 'Korean',
    });

    expect(result.statsPayload?.overview).toBeUndefined();
    expect(result.statsPayload?.routes).toBeUndefined();
    expect(result.statsPayload?.raw).toEqual([{ errorCode: 'PAY_404', count: 1 }]);
    expect(result.sources).toEqual([]);
  });
});
