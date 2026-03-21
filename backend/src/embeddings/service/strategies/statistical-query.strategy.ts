import { Injectable, Logger } from '@nestjs/common';
import {
  EmbeddingPort,
  SynthesisPort,
  LogStoragePort,
} from '@embeddings/out-ports';
import {
  AnalysisResult,
  LogSource,
  LogStats,
  RouteMetric,
  StatsPayload,
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
      const { templateId, params } =
        await this.synthesisPort.analyzeStatisticalQuery(
          reformulatedQuery,
          metadata,
        );
      this.logger.log(
        `LLM detected template: ${templateId}, params: ${JSON.stringify(params)}`,
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

      const statsPayload = this.buildStatsPayload(aggregationResults);
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

  private buildStatsPayload(aggregationResults: any[]): StatsPayload {
    const results = Array.isArray(aggregationResults) ? aggregationResults : [];
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
            ? 1 - row.errorRate
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

    return {
      overview: hasOverview
        ? {
            totalRequests: overview.totalRequests ?? 0,
            failedRequests: overview.failedRequests ?? 0,
            successRate: overview.successRate ?? 0,
            averageDurationMs: overview.averageDurationMs ?? 0,
          }
        : undefined,
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
