import { Injectable, Logger } from '@nestjs/common';
import {
  EmbeddingPort,
  RerankPort,
  SynthesisPort,
  LogStoragePort,
} from '@embeddings/out-ports';
import { AnalysisResult } from '@embeddings/dtos';
import {
  AnalysisIntent,
  SEMANTIC_KEYWORDS,
} from '@embeddings/value-objects/filter';
import {
  QueryPreprocessorService,
  SessionCacheService,
  SemanticCacheService,
} from '@embeddings/service/sub-services';
import { QueryStrategy, QueryContext } from './query-strategy.interface';

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

  readonly intent = AnalysisIntent.SEMANTIC;
  readonly priority = 10; // Lower priority than statistical

  constructor(
    private readonly embeddingPort: EmbeddingPort,
    private readonly rerankPort: RerankPort,
    private readonly synthesisPort: SynthesisPort,
    private readonly logStoragePort: LogStoragePort,
    private readonly queryPreprocessor: QueryPreprocessorService,
    private readonly sessionCache: SessionCacheService,
    private readonly semanticCache: SemanticCacheService,
  ) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  canHandle(query: string, _history: AnalysisResult[]): boolean {
    const lowerQuery = query.toLowerCase();
    return SEMANTIC_KEYWORDS.some((k) => lowerQuery.includes(k));
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

    let vectorResults = this.semanticCache.getCachedResults(
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

    this.logger.log(`Top results: ${JSON.stringify(topResults, null, 2)}`);

    const eventIds = topResults.map((res) => res.eventId);

    let fullLogs = await this.logStoragePort.getLogsByEventIds(eventIds);
    this.logger.log(`Full logs: ${JSON.stringify(fullLogs, null, 2)}`);

    if (metadata.hasError || metadata.errorCode) {
      fullLogs = fullLogs.filter((log) => {
        if (metadata.hasError && !log.error) {
          return false;
        }
        if (metadata.errorCode && log.error?.code !== metadata.errorCode) {
          return false;
        }
        return true;
      });
      this.logger.log(`Filtered logs: ${JSON.stringify(fullLogs, null, 2)}`);
      if (fullLogs.length === 0) {
        this.logger.warn(
          `Post-filtering removed all results. Original count: ${eventIds.length}, Filtered: 0`,
        );
      }
    }

    const requestIds = fullLogs.map((log) => log.requestId).filter(Boolean);

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
      sources: requestIds,
      confidence: finalConfidence,
      sessionId,
      createdAt: new Date(),
    };

    if (sessionId) {
      await this.sessionCache.updateSession(sessionId, result);
    }

    return result;
  }

  private async verifyGrounding(
    query: string,
    answer: string,
    confidence: number,
    fullLogs: any[],
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
    };
  }
}
