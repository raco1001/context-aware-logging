import { Injectable, Logger } from '@nestjs/common';
import {
  EmbeddingPort,
  SynthesisPort,
  LogStoragePort,
} from '@embeddings/out-ports';
import { AnalysisResult } from '@embeddings/dtos';
import {
  AnalysisIntent,
  STATISTIC_KEYWORDS,
  AGGREGATION_KEYWORDS,
} from '@embeddings/value-objects/filter';
import {
  QueryPreprocessorService,
  AggregationService,
  SessionCacheService,
  SemanticCacheService,
} from '@embeddings/service/sub-services';
import { QueryStrategy, QueryContext } from './query-strategy.interface';

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
  readonly priority = 20; // Higher priority than semantic

  constructor(
    private readonly embeddingPort: EmbeddingPort,
    private readonly synthesisPort: SynthesisPort,
    private readonly logStoragePort: LogStoragePort,
    private readonly queryPreprocessor: QueryPreprocessorService,
    private readonly aggregation: AggregationService,
    private readonly sessionCache: SessionCacheService,
    private readonly semanticCache: SemanticCacheService,
  ) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  canHandle(query: string, _history: AnalysisResult[]): boolean {
    const lowerQuery = query.toLowerCase();
    return (
      AGGREGATION_KEYWORDS.some((k) => lowerQuery.includes(k)) ||
      STATISTIC_KEYWORDS.some((k) => lowerQuery.includes(k))
    );
  }

  async execute(context: QueryContext): Promise<AnalysisResult> {
    const {
      originalQuery,
      reformulatedQuery,
      isStandalone,
      metadata,
      history,
      sessionId,
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

      const requestIds = aggregationResults
        ? aggregationResults
            .flatMap((result: any) =>
              result.examples
                ? result.examples.map((ex: any) => ex.requestId)
                : [],
            )
            .filter(Boolean)
        : [];

      const result: AnalysisResult = {
        question: originalQuery,
        intent: this.intent,
        answer: finalAnswer,
        sources: requestIds,
        confidence: finalConfidence,
        sessionId,
      };

      if (sessionId) {
        await this.sessionCache.updateSession(sessionId, result);
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
}
