import { Injectable, Logger } from '@nestjs/common';
import {
  EmbeddingPort,
  RerankPort,
  SynthesisPort,
  LogStoragePort,
} from '@embeddings/out-ports';
import { AnalysisResult, LogSource } from '@embeddings/dtos';
import { RawLogDocument, VectorSearchResult } from '@embeddings/domain';
import { AnalysisIntent } from '@embeddings/value-objects/filter';
import { SessionCacheService } from '../../infrastructure/cache/session-cache.service';
import { SemanticCacheService } from '../../infrastructure/cache/semantic-cache.service';
import { QueryPreprocessorService } from '../preprocessing';
import { QueryStrategy, QueryContext } from '@embeddings/in-ports';

/**
 * SemanticQueryStrategy - Handles semantic/vector-based queries.
 *
 * Pipeline:
 * 1. Transform query to log-style narrative
 * 2. Create embedding
 * 3. Vector search (with semantic cache)
 * 4. Rerank results
 * 5. Fetch full logs
 * 6. Synthesize answer
 * 7. Verify grounding
 */
@Injectable()
export class SemanticQueryStrategy implements QueryStrategy {
  private readonly logger = new Logger(SemanticQueryStrategy.name);
  private static readonly NO_MATCHING_LOGS_MESSAGE =
    '지정한 조건에 맞는 로그를 찾지 못했습니다. 조건(에러 코드/오류 여부/시간 범위/서비스 등)을 완화해서 다시 질문해 주세요.';

  readonly intent = AnalysisIntent.SEMANTIC;

  constructor(
    private readonly embeddingPort: EmbeddingPort,
    private readonly rerankPort: RerankPort,
    private readonly synthesisPort: SynthesisPort,
    private readonly logStoragePort: LogStoragePort,
    private readonly queryPreprocessor: QueryPreprocessorService,
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
      `Executing semantic query strategy for: "${originalQuery}"`,
    );

    // Transform query to log-style narrative for better semantic matching
    const logStyleQuery =
      await this.synthesisPort.transformQueryToLogStyle(reformulatedQuery);

    const structuredQuery = this.queryPreprocessor.preprocessQuery(
      logStyleQuery,
      metadata,
    );

    this.logger.log(
      `\n\n 
        Original query: "${originalQuery}" \n
        -> Transformed query (log-style): "${logStyleQuery}" \n
        -> Structured query: "${structuredQuery}" \n`,
    );

    const { embedding } =
      await this.embeddingPort.createEmbedding(structuredQuery);

    this.logger.log(
      `Performing vector search with embedding (dimension: ${embedding.length}), metadata: ${JSON.stringify(metadata)}`,
    );

    let vectorResults: VectorSearchResult[] | null =
      this.semanticCache.getCachedResults(
      embedding,
      metadata,
    );

    if (vectorResults && vectorResults.length > 0) {
      this.logger.log(
        `Semantic cache hit! Using cached vector results (${vectorResults.length} results)`,
      );
    } else {
      this.logger.log(
        vectorResults
          ? `Semantic cache hit but empty results, performing vector search`
          : `Semantic cache miss, performing vector search`,
      );
      vectorResults = await this.logStoragePort.vectorSearch(
        embedding,
        10,
        metadata,
      );

      if (vectorResults && vectorResults.length > 0) {
        this.semanticCache.setCachedResults(embedding, metadata, vectorResults);
      }
    }

    this.logger.log(
      `Vector search returned ${vectorResults?.length || 0} results`,
    );

    if (!vectorResults || vectorResults.length === 0) {
      this.logger.warn(
        `No vector search results found. This could mean:
          1. No embeddings exist in wide_events_embedded collection
          2. Service filter is too strict (filtering by: ${metadata.service || 'none'})
          3. Vector search index may not be properly configured
          Consider running: POST /embeddings/batch?limit=100 to create embeddings`,
      );
      return this.createEmptyResult(originalQuery, sessionId);
    }

    if (vectorResults.length > 0) {
      this.logger.log(
        `Top 3 vector search results:\n${vectorResults
          .slice(0, 3)
          .map(
            (r, i) =>
              `  ${i + 1}. Score: ${r.score?.toFixed(4) || 'N/A'}, Summary: ${r.summary?.substring(0, 100) || 'N/A'}`,
          )
          .join('\n')}`,
      );
    }

    const documentsForRerank = vectorResults.map((res) => res.summary);
    const rerankedIndices = await this.rerankPort.rerank(
      originalQuery,
      documentsForRerank,
      5,
    );
    this.logger.log(
      `Reranked indices: ${JSON.stringify(rerankedIndices, null, 2)}`,
    );
    const topResults = rerankedIndices.map((item) => vectorResults[item.index]);

    this.logger.log(
      `Rerank selected ${topResults.length} results (from ${vectorResults.length})`,
    );
    this.logger.log(`Top results: ${JSON.stringify(topResults, null, 2)}`);

    const eventIds = topResults.map((res) => res.eventId);

    let fullLogs: RawLogDocument[] =
      await this.logStoragePort.getLogsByEventIds(eventIds);
    this.logger.log(
      `Fetched full logs: requestedEventIds=${eventIds.length}, fetchedLogs=${fullLogs.length}`,
    );
    this.logger.log(`Full logs: ${JSON.stringify(fullLogs, null, 2)}`);

    if (metadata.hasError || metadata.errorCode) {
      const fullLogsBeforeFilter = fullLogs;
      const applySafetyFilter = (
        logs: RawLogDocument[],
        opts: { hasError?: boolean; errorCode?: string | null },
      ): RawLogDocument[] => {
        return logs.filter((log) => {
          if (opts.hasError && !log.error) return false;
          if (opts.errorCode && log.error?.code !== opts.errorCode) return false;
          return true;
        });
      };

      fullLogs = applySafetyFilter(fullLogs, {
        hasError: metadata.hasError,
        errorCode: metadata.errorCode,
      });
      this.logger.log(
        `Post-filter safety filter applied: before=${fullLogsBeforeFilter.length}, after=${fullLogs.length}, hasError=${metadata.hasError}, errorCode=${metadata.errorCode ?? 'null'}`,
      );
      this.logger.log(`Filtered logs: ${JSON.stringify(fullLogs, null, 2)}`);
      if (fullLogs.length === 0) {
        this.logger.warn(
          `Post-filtering removed all results. Original count: ${eventIds.length}, Filtered: 0`,
        );

        // Stepwise relaxation: errorCode -> hasError only -> no post-filter
        if (metadata.errorCode && metadata.hasError) {
          const relaxedHasErrorOnly = applySafetyFilter(fullLogsBeforeFilter, {
            hasError: true,
          });
          this.logger.warn(
            `Relaxation step A (drop errorCode, keep hasError) restored ${relaxedHasErrorOnly.length} logs`,
          );
          if (relaxedHasErrorOnly.length > 0) {
            fullLogs = relaxedHasErrorOnly;
          }
        }

        if (fullLogs.length === 0) {
          const relaxedNoPostFilter = fullLogsBeforeFilter;
          this.logger.warn(
            `Relaxation step B (drop hasError) restored ${relaxedNoPostFilter.length} logs`,
          );
          if (relaxedNoPostFilter.length > 0) {
            fullLogs = relaxedNoPostFilter;
          }
        }

        if (fullLogs.length === 0) {
          this.logger.warn(
            `No logs available even after relaxation. Returning deterministic response.`,
          );
          const result: AnalysisResult = {
            question: originalQuery,
            intent: this.intent,
            answer: SemanticQueryStrategy.NO_MATCHING_LOGS_MESSAGE,
            sources: [],
            confidence: 0,
            sessionId,
            viewType: 'chat',
            createdAt: new Date().toISOString(),
          };

          if (sessionId) {
            await this.sessionCache.updateSession(sessionId, result, clientId);
          }

          return result;
        }
      }
    }

    const synthesisHistory = isStandalone ? [] : history;

    const { answer, confidence } = await this.synthesisPort.synthesize(
      reformulatedQuery,
      fullLogs,
      synthesisHistory,
      targetLanguage,
    );

    this.logger.log(
      `Synthesized answer (raw): "${answer.substring(0, 100)}${answer.length > 100 ? '...' : ''}" (confidence: ${confidence})`,
    );

    const { finalAnswer, finalConfidence } = await this.verifyGrounding(
      reformulatedQuery,
      answer,
      confidence,
      fullLogs,
    );

    const result: AnalysisResult = {
      question: originalQuery,
      intent: this.intent,
      answer: finalAnswer,
      sources: this.toLogSources(fullLogs),
      confidence: finalConfidence,
      sessionId,
      viewType: 'chat',
      createdAt: new Date().toISOString(),
    };

    if (sessionId) {
      await this.sessionCache.updateSession(sessionId, result, clientId);
    }

    return result;
  }

  private async verifyGrounding(
    query: string,
    answer: string,
    confidence: number,
    fullLogs: RawLogDocument[],
  ): Promise<{ finalAnswer: string; finalConfidence: number }> {
    let finalAnswer = answer;
    let finalConfidence = confidence;

    try {
      const verification = await this.synthesisPort.verifyGrounding(
        query,
        answer,
        fullLogs,
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

  private createEmptyResult(
    question: string,
    sessionId?: string,
  ): AnalysisResult {
    return {
      question,
      intent: this.intent,
      answer: 'Not enough evidence.',
      sources: [],
      sessionId,
      confidence: 0,
      viewType: 'chat',
    };
  }

  private toLogSources(fullLogs: RawLogDocument[]): LogSource[] {
    return fullLogs
      .filter((log) => Boolean(log.requestId))
      .map((log) => ({
        id: log.requestId,
        summary: log._summary ?? '',
        status: log.error ? 'FAILED' : 'SUCCESS',
        route: log.route ?? '',
        duration: log.performance?.durationMs ?? 0,
        timestamp: this.toIsoString(log.timestamp),
        errorCode: log.error?.code,
        failedAt: log.failedAt,
      }));
  }

  private toIsoString(value: Date): string {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value.toISOString();
    }
    return new Date(0).toISOString();
  }
}
