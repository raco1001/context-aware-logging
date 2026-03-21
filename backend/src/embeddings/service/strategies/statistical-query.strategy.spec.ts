import { StatisticalQueryStrategy } from './statistical-query.strategy';
import { AnalysisResult } from '@embeddings/dtos';

describe('StatisticalQueryStrategy (stats payload mapping)', () => {
  const baseContext = {
    originalQuery: 'q',
    reformulatedQuery: 'q',
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
    targetLanguage: 'Korean' as const,
    templateParams: { metadata: {}, topN: 5 },
  };

  const makeStrategy = (aggregationResults: any[]) => {
    const embeddingPort = {
      createEmbedding: jest.fn().mockResolvedValue({ embedding: [0.1, 0.2] }),
    } as any;

    const synthesisPort = {
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

  it('legacy template merges mixed aggregation rows into overview and routes', async () => {
    const { strategy } = makeStrategy(
      [
        {
          totalCount: 100,
          errorCount: 20,
          errorRate: 20,
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
      ],
    );

    const result = await strategy.execute({
      ...baseContext,
      originalQuery: '에러율이 어떻게 돼?',
      reformulatedQuery: '에러율이 어떻게 돼?',
      templateId: 'UNKNOWN_TEMPLATE',
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

  it('TOP_ERROR_CODES maps rows to breakdown without overview', async () => {
    const { strategy } = makeStrategy([{ errorCode: 'PAY_404', count: 1 }]);

    const result = await strategy.execute({
      ...baseContext,
      originalQuery: '통계 보여줘',
      reformulatedQuery: '통계 보여줘',
      sessionId: 's2',
      templateId: 'TOP_ERROR_CODES',
    });

    expect(result.statsPayload?.overview).toBeUndefined();
    expect(result.statsPayload?.routes).toBeUndefined();
    expect(result.statsPayload?.breakdown).toEqual([
      { label: 'PAY_404', count: 1 },
    ]);
    expect(result.statsPayload?.raw).toEqual([{ errorCode: 'PAY_404', count: 1 }]);
    expect(result.sources).toEqual([]);
  });

  it('ERROR_RATE derives successRate from percentage errorRate', async () => {
    const { strategy } = makeStrategy([
      { totalCount: 1000, errorCount: 50, errorRate: 5 },
    ]);

    const result = await strategy.execute({
      ...baseContext,
      templateId: 'ERROR_RATE',
    });

    expect(result.statsPayload?.overview).toEqual({
      totalRequests: 1000,
      failedRequests: 50,
      successRate: 0.95,
    });
  });

  it('ERROR_RATE facet maps summary and hourly timeseries', async () => {
    const { strategy } = makeStrategy([
      {
        summary: [{ totalCount: 100, errorCount: 20, errorRate: 20 }],
        series: [
          { bucket: '2026-03-19T10:00:00.000Z', total: 50, failed: 10 },
          { bucket: '2026-03-19T11:00:00.000Z', total: 50, failed: 10 },
        ],
      },
    ]);

    const result = await strategy.execute({
      ...baseContext,
      templateId: 'ERROR_RATE',
    });

    expect(result.statsPayload?.overview).toEqual({
      totalRequests: 100,
      failedRequests: 20,
      successRate: 0.8,
    });
    expect(result.statsPayload?.timeseries).toHaveLength(2);
    expect(result.statsPayload?.timeseries?.[0]).toEqual({
      bucket: '2026-03-19T10:00:00.000Z',
      total: 50,
      failed: 10,
    });
  });

  it('ERROR_RATE facet maps latency percentiles and halfWindow', async () => {
    const { strategy } = makeStrategy([
      {
        summary: [{ totalCount: 100, errorCount: 20, errorRate: 20 }],
        series: [
          { bucket: '2026-03-19T10:00:00.000Z', total: 100, failed: 20 },
        ],
        latency: [
          {
            count: 80,
            p50: 50,
            p95: 120,
            p99: 200,
            avg: 60,
            max: 300,
          },
        ],
        trendHalves: [
          {
            _id: 'first',
            totalCount: 40,
            errorCount: 8,
            errorRatePct: 18,
          },
          {
            _id: 'second',
            totalCount: 60,
            errorCount: 12,
            errorRatePct: 22,
          },
        ],
      },
    ]);

    const result = await strategy.execute({
      ...baseContext,
      templateId: 'ERROR_RATE',
    });

    expect(result.statsPayload?.overview).toEqual({
      totalRequests: 100,
      failedRequests: 20,
      successRate: 0.8,
      averageDurationMs: 50,
    });
    expect(result.statsPayload?.percentiles).toEqual([
      { percentile: 'P50', valueMs: 50, requestCount: 80 },
      { percentile: 'P95', valueMs: 120, requestCount: 80 },
      { percentile: 'P99', valueMs: 200, requestCount: 80 },
    ]);
    expect(result.statsPayload?.halfWindow).toEqual({
      firstErrorRatePct: 18,
      secondErrorRatePct: 22,
    });
  });

  it('LATENCY_PERCENTILE maps percentiles and p50-based averageDurationMs', async () => {
    const { strategy } = makeStrategy([
      {
        count: 200,
        p50: 42,
        p95: 180,
        p99: 400,
        avg: 55,
        max: 900,
      },
    ]);

    const result = await strategy.execute({
      ...baseContext,
      templateId: 'LATENCY_PERCENTILE',
    });

    expect(result.statsPayload?.overview).toEqual({
      totalRequests: 200,
      failedRequests: 0,
      successRate: 1,
      averageDurationMs: 42,
    });
    expect(result.statsPayload?.percentiles).toEqual([
      { percentile: 'P50', valueMs: 42, requestCount: 200 },
      { percentile: 'P95', valueMs: 180, requestCount: 200 },
      { percentile: 'P99', valueMs: 400, requestCount: 200 },
    ]);
  });
});
