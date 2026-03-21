import { Injectable, Logger } from '@nestjs/common';
import {
  EmbeddingPort,
  SynthesisPort,
  LogStoragePort,
} from '@embeddings/out-ports';
import {
  AnalysisResult,
  ErrorTrendHalfWindow,
  LogSource,
  LogStats,
  PercentileRow,
  RouteMetric,
  StatsPayload,
  TimeSeriesPoint,
} from '@embeddings/dtos';
import { AnalysisIntent } from '@embeddings/value-objects/filter';
import { SessionCacheService } from '../../infrastructure/cache/session-cache.service';
import { SemanticCacheService } from '../../infrastructure/cache/semantic-cache.service';
import { AggregationService } from '../aggregation.service';
import { QueryPreprocessorService } from '../preprocessing';
import { QueryStrategy, QueryContext } from '@embeddings/in-ports';

/**
 * StatisticalQueryStrategy - Handles statistical/aggregation queries.
 *
 * Pipeline:
 * 1. Analyze query to detect aggregation template
 * 2. Execute MongoDB aggregation pipeline
 * 3. Optionally fetch context logs via vector search
 * 4. Synthesize answer from aggregation results
 * 5. Verify grounding
 */
@Injectable()
export class StatisticalQueryStrategy implements QueryStrategy {
  private readonly logger = new Logger(StatisticalQueryStrategy.name);

  readonly intent = AnalysisIntent.STATISTICAL;

  constructor(
    private readonly embeddingPort: EmbeddingPort,
    private readonly synthesisPort: SynthesisPort,
    private readonly logStoragePort: LogStoragePort,
    private readonly queryPreprocessor: QueryPreprocessorService,
    private readonly aggregation: AggregationService,
    private readonly sessionCache: SessionCacheService,
    private readonly semanticCache: SemanticCacheService,
  ) {}

  async execute(context: QueryContext): Promise<AnalysisResult> {
    const {
      originalQuery,
      reformulatedQuery,
      isStandalone,
      metadata,
      history,
      sessionId,
      clientId,
      targetLanguage,
    } = context;

    this.logger.log(
      `Executing statistical query strategy for: "${reformulatedQuery}"`,
    );

    try {
      if (!context.templateId || !context.templateParams) {
        throw new Error(
          `StatisticalQueryStrategy requires templateId and templateParams in context (got templateId=${context.templateId ?? 'null'}). Routing mismatch?`,
        );
      }

      const templateId = context.templateId;
      const params = context.templateParams;

      this.logger.log(
        `Template from context: ${templateId}, params: ${JSON.stringify(params)}`,
      );

      const aggregationResults = await this.aggregation.executeTemplate(
        templateId,
        params,
      );

      let contextLogs: any[] = [];
      if (aggregationResults && aggregationResults.length > 0) {
        contextLogs = await this.fetchContextLogs(
          reformulatedQuery,
          params,
          metadata,
        );
      }

      const synthesisContext = {
        aggregationResults,
        contextLogs: contextLogs.slice(0, 5),
      };

      const synthesisHistory = isStandalone ? [] : history;

      const { answer, confidence } = await this.synthesisPort.synthesize(
        reformulatedQuery,
        [synthesisContext],
        synthesisHistory,
        targetLanguage,
      );

      this.logger.log(
        `Synthesized statistical answer (raw): "${answer.substring(0, 100)}${answer.length > 100 ? '...' : ''}" (confidence: ${confidence})`,
      );

      const verificationContext = [
        ...(aggregationResults || []),
        ...(contextLogs.slice(0, 5) || []),
      ];

      const { finalAnswer, finalConfidence } = await this.verifyGrounding(
        reformulatedQuery,
        answer,
        confidence,
        verificationContext,
      );

      const statsPayload = this.buildStatsPayload(aggregationResults, templateId);
      const sources = this.toLogSourcesFromAggregation(aggregationResults);

      const result: AnalysisResult = {
        question: originalQuery,
        intent: this.intent,
        answer: finalAnswer,
        sources,
        confidence: finalConfidence,
        sessionId,
        viewType: 'chat+analytics',
        statsPayload,
        createdAt: new Date().toISOString(),
      };

      if (sessionId) {
        await this.sessionCache.updateSession(sessionId, result, clientId);
      }

      return result;
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `Statistical query handling failed: ${err.message}`,
        err.stack,
      );
      throw error;
    }
  }

  private async fetchContextLogs(
    reformulatedQuery: string,
    params: any,
    metadata: any,
  ): Promise<any[]> {
    // Use log-style transformation for better context log retrieval
    const logStyleQuery =
      await this.synthesisPort.transformQueryToLogStyle(reformulatedQuery);
    const searchMetadata = params.metadata || metadata;
    const structuredQuery = this.queryPreprocessor.preprocessQuery(
      logStyleQuery,
      searchMetadata,
    );

    const { embedding } =
      await this.embeddingPort.createEmbedding(structuredQuery);

    let contextLogs = this.semanticCache.getCachedResults(
      embedding,
      searchMetadata,
    );

    if (contextLogs && contextLogs.length > 0) {
      this.logger.log(
        `Semantic cache hit for statistical query context logs (${contextLogs.length} results)`,
      );
      return contextLogs.slice(0, 5);
    }

    this.logger.log(
      contextLogs
        ? `Semantic cache hit but empty results for statistical query, performing vector search`
        : `Semantic cache miss for statistical query, performing vector search`,
    );

    contextLogs = await this.logStoragePort.vectorSearch(
      embedding,
      5,
      searchMetadata,
    );

    if (contextLogs && contextLogs.length > 0) {
      this.semanticCache.setCachedResults(
        embedding,
        searchMetadata,
        contextLogs,
      );
    }

    return contextLogs || [];
  }

  private async verifyGrounding(
    query: string,
    answer: string,
    confidence: number,
    verificationContext: any[],
  ): Promise<{ finalAnswer: string; finalConfidence: number }> {
    let finalAnswer = answer;
    let finalConfidence = confidence;

    try {
      const verification = await this.synthesisPort.verifyGrounding(
        query,
        answer,
        verificationContext,
      );

      this.logger.log(
        `Grounding verification: ${verification.status}, action: ${verification.action}`,
      );

      if (verification.action === 'REJECT_ANSWER') {
        finalAnswer = 'Not enough evidence to provide a reliable answer.';
        finalConfidence = 0;
        this.logger.warn(
          `Answer rejected due to insufficient grounding. Unverified claims: ${verification.unverifiedClaims.join(', ')}`,
        );
      } else if (verification.action === 'ADJUST_CONFIDENCE') {
        finalConfidence = Math.min(
          confidence,
          confidence * verification.confidenceAdjustment,
        );
        if (verification.unverifiedClaims.length > 0) {
          finalAnswer = `${answer}\n\n[Note: Some claims could not be fully verified: ${verification.unverifiedClaims.join(', ')}]`;
        }
        this.logger.log(
          `Confidence adjusted from ${confidence} to ${finalConfidence} based on verification`,
        );
      }
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `Grounding verification failed, using original answer: ${err.message}`,
      );
    }

    return { finalAnswer, finalConfidence };
  }

  private buildStatsPayload(
    aggregationResults: any[],
    templateId: string,
  ): StatsPayload {
    const results = Array.isArray(aggregationResults) ? aggregationResults : [];
    switch (templateId) {
      case 'ERROR_RATE':
        return this.buildErrorRateStatsPayload(results);
      case 'TOP_ERROR_CODES':
        return this.buildTopErrorCodesStatsPayload(results);
      case 'ERROR_DISTRIBUTION_BY_ROUTE':
        return this.buildErrorDistributionByRouteStatsPayload(results);
      case 'LATENCY_PERCENTILE':
        return this.buildLatencyPercentileStatsPayload(results);
      case 'ERROR_BY_SERVICE':
        return this.buildErrorByServiceStatsPayload(results);
      default:
        return this.buildLegacyStatsPayload(results);
    }
  }

  /**
   * ERROR_RATE: `$facet` shape `{ summary, series, latency?, trendHalves? }` or legacy
   * single row `{ totalCount, errorCount, errorRate }`.
   */
  private buildErrorRateStatsPayload(results: any[]): StatsPayload {
    const first = results[0];
    if (
      first &&
      typeof first === 'object' &&
      Array.isArray(first.summary) &&
      first.series !== undefined
    ) {
      const row = first.summary[0];
      const timeseries = this.mapErrorRateSeriesToTimeSeries(first.series);
      const latencyRow = Array.isArray(first.latency) ? first.latency[0] : undefined;
      const { percentiles, averageDurationMs } =
        this.mapErrorRateLatencyFacetRow(latencyRow);
      const halfWindow = this.parseErrorRateTrendHalves(first.trendHalves);

      if (!row) {
        return {
          overview: {
            totalRequests: 0,
            failedRequests: 0,
            successRate: 1,
            ...(averageDurationMs !== undefined ? { averageDurationMs } : {}),
          },
          timeseries: timeseries.length > 0 ? timeseries : undefined,
          percentiles,
          halfWindow,
          raw: results,
        };
      }
      const totalRequests = row.totalCount;
      const failedRequests = row.errorCount;
      const successRate =
        typeof row.errorRate === 'number'
          ? 1 - row.errorRate / 100
          : totalRequests > 0
            ? (totalRequests - failedRequests) / totalRequests
            : 0;

      return {
        overview: {
          totalRequests,
          failedRequests,
          successRate: this.normalizeRate(successRate),
          ...(averageDurationMs !== undefined ? { averageDurationMs } : {}),
        },
        timeseries: timeseries.length > 0 ? timeseries : undefined,
        percentiles,
        halfWindow,
        raw: results,
      };
    }

    const row = results[0];
    if (
      !row ||
      typeof row.totalCount !== 'number' ||
      typeof row.errorCount !== 'number'
    ) {
      return { raw: results };
    }
    const totalRequests = row.totalCount;
    const failedRequests = row.errorCount;
    const successRate =
      typeof row.errorRate === 'number'
        ? 1 - row.errorRate / 100
        : totalRequests > 0
          ? (totalRequests - failedRequests) / totalRequests
          : 0;

    return {
      overview: {
        totalRequests,
        failedRequests,
        successRate: this.normalizeRate(successRate),
      },
      raw: results,
    };
  }

  private mapErrorRateSeriesToTimeSeries(series: any): TimeSeriesPoint[] {
    if (!Array.isArray(series)) return [];
    const out: TimeSeriesPoint[] = [];
    for (const r of series) {
      if (
        r &&
        typeof r.bucket === 'string' &&
        typeof r.total === 'number' &&
        typeof r.failed === 'number'
      ) {
        out.push({
          bucket: r.bucket,
          total: r.total,
          failed: r.failed,
        });
      }
    }
    return out;
  }

  /** Latency facet row: same shape as LATENCY_PERCENTILE single document. */
  private mapErrorRateLatencyFacetRow(row: any): {
    percentiles?: PercentileRow[];
    averageDurationMs?: number;
  } {
    if (!row || typeof row.count !== 'number' || row.count < 1) {
      return {};
    }
    const count = row.count;
    const percentiles: PercentileRow[] = [];
    if (typeof row.p50 === 'number') {
      percentiles.push({
        percentile: 'P50',
        valueMs: row.p50,
        requestCount: count,
      });
    }
    if (typeof row.p95 === 'number') {
      percentiles.push({
        percentile: 'P95',
        valueMs: row.p95,
        requestCount: count,
      });
    }
    if (typeof row.p99 === 'number') {
      percentiles.push({
        percentile: 'P99',
        valueMs: row.p99,
        requestCount: count,
      });
    }
    const averageDurationMs =
      typeof row.p50 === 'number'
        ? row.p50
        : typeof row.avg === 'number'
          ? row.avg
          : undefined;

    return {
      percentiles: percentiles.length > 0 ? percentiles : undefined,
      averageDurationMs,
    };
  }

  private parseErrorRateTrendHalves(
    trendHalves: any,
  ): ErrorTrendHalfWindow | undefined {
    if (!Array.isArray(trendHalves) || trendHalves.length === 0) {
      return undefined;
    }
    const first = trendHalves.find((x: any) => x._id === 'first');
    const second = trendHalves.find((x: any) => x._id === 'second');
    if (
      !first ||
      !second ||
      typeof first.errorRatePct !== 'number' ||
      typeof second.errorRatePct !== 'number'
    ) {
      return undefined;
    }
    return {
      firstErrorRatePct: first.errorRatePct,
      secondErrorRatePct: second.errorRatePct,
    };
  }

  /** TOP_ERROR_CODES: rows { errorCode, count, examples }. */
  private buildTopErrorCodesStatsPayload(results: any[]): StatsPayload {
    const breakdown = results.map((r) => ({
      label: String(r.errorCode ?? 'unknown'),
      count: typeof r.count === 'number' ? r.count : 0,
    }));
    return {
      breakdown: breakdown.length > 0 ? breakdown : undefined,
      raw: results,
    };
  }

  /** ERROR_DISTRIBUTION_BY_ROUTE: rows { route, count, errorCodes? }. */
  private buildErrorDistributionByRouteStatsPayload(results: any[]): StatsPayload {
    const routes: RouteMetric[] = results.map((r) => {
      const count = typeof r.count === 'number' ? r.count : 0;
      return {
        route: typeof r.route === 'string' ? r.route : String(r.route ?? ''),
        failed: count,
        total: count,
      };
    });
    return {
      routes: routes.length > 0 ? routes : undefined,
      raw: results,
    };
  }

  /** LATENCY_PERCENTILE: single row { count, p50, p95, p99, avg, max }. */
  private buildLatencyPercentileStatsPayload(results: any[]): StatsPayload {
    const row = results[0];
    if (!row) {
      return { raw: results };
    }
    const count = typeof row.count === 'number' ? row.count : 0;
    const percentiles: { percentile: string; valueMs: number; requestCount?: number }[] =
      [];
    if (typeof row.p50 === 'number') {
      percentiles.push({
        percentile: 'P50',
        valueMs: row.p50,
        requestCount: count,
      });
    }
    if (typeof row.p95 === 'number') {
      percentiles.push({
        percentile: 'P95',
        valueMs: row.p95,
        requestCount: count,
      });
    }
    if (typeof row.p99 === 'number') {
      percentiles.push({
        percentile: 'P99',
        valueMs: row.p99,
        requestCount: count,
      });
    }

    const averageDurationMs =
      typeof row.p50 === 'number'
        ? row.p50
        : typeof row.avg === 'number'
          ? row.avg
          : undefined;

    return {
      overview: {
        totalRequests: count,
        failedRequests: 0,
        successRate: 1,
        ...(averageDurationMs !== undefined ? { averageDurationMs } : {}),
      },
      percentiles: percentiles.length > 0 ? percentiles : undefined,
      raw: results,
    };
  }

  /** ERROR_BY_SERVICE: rows { service, count, topErrorCodes? }. */
  private buildErrorByServiceStatsPayload(results: any[]): StatsPayload {
    const breakdown = results.map((r) => ({
      label: typeof r.service === 'string' ? r.service : String(r.service ?? 'unknown'),
      count: typeof r.count === 'number' ? r.count : 0,
    }));
    return {
      breakdown: breakdown.length > 0 ? breakdown : undefined,
      raw: results,
    };
  }

  /** Generic probe-based mapping for unknown / future templates. */
  private buildLegacyStatsPayload(results: any[]): StatsPayload {
    const overview: Partial<LogStats> = {};
    const routes: RouteMetric[] = [];

    for (const row of results) {
      if (
        typeof row?.totalCount === 'number' &&
        typeof row?.errorCount === 'number'
      ) {
        const totalRequests = row.totalCount;
        const failedRequests = row.errorCount;
        const successRate =
          typeof row.errorRate === 'number'
            ? 1 - row.errorRate / 100
            : totalRequests > 0
              ? (totalRequests - failedRequests) / totalRequests
              : 0;

        overview.totalRequests = totalRequests;
        overview.failedRequests = failedRequests;
        overview.successRate = this.normalizeRate(successRate);
      }

      if (typeof row?.avg === 'number') {
        overview.averageDurationMs = row.avg;
      }

      if (typeof row?.route === 'string' && typeof row?.count === 'number') {
        routes.push({
          route: row.route,
          failed: row.count,
        });
      }
    }

    const hasOverview =
      typeof overview.totalRequests === 'number' ||
      typeof overview.failedRequests === 'number' ||
      typeof overview.successRate === 'number' ||
      typeof overview.averageDurationMs === 'number';

    const overviewOut: LogStats | undefined = hasOverview
      ? {
          totalRequests: overview.totalRequests ?? 0,
          failedRequests: overview.failedRequests ?? 0,
          successRate: overview.successRate ?? 0,
          ...(typeof overview.averageDurationMs === 'number'
            ? { averageDurationMs: overview.averageDurationMs }
            : {}),
        }
      : undefined;

    return {
      overview: overviewOut,
      routes: routes.length > 0 ? routes : undefined,
      raw: results,
    };
  }

  private toLogSourcesFromAggregation(aggregationResults: any[]): LogSource[] {
    const results = Array.isArray(aggregationResults) ? aggregationResults : [];
    const sourceMap = new Map<string, LogSource>();

    for (const row of results) {
      const examples = Array.isArray(row?.examples) ? row.examples : [];
      for (const ex of examples) {
        const requestId =
          typeof ex?.requestId === 'string' ? ex.requestId : undefined;
        if (!requestId) continue;

        sourceMap.set(requestId, {
          id: requestId,
          summary: typeof ex?.errorMessage === 'string' ? ex.errorMessage : '',
          status: 'FAILED',
          route: typeof ex?.route === 'string' ? ex.route : '',
          duration: 0,
          timestamp: this.toIsoString(ex?.timestamp),
          errorCode:
            typeof ex?.errorCode === 'string' ? ex.errorCode : undefined,
          failedAt: typeof ex?.failedAt === 'string' ? ex.failedAt : undefined,
        });
      }
    }

    return Array.from(sourceMap.values());
  }

  private toIsoString(value: unknown): string {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value.toISOString();
    }

    if (typeof value === 'string') {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString();
      }
    }

    return new Date(0).toISOString();
  }

  private normalizeRate(value: number): number {
    if (!Number.isFinite(value)) return 0;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
  }
}
