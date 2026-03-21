import { Injectable, Logger } from '@nestjs/common';
import { SynthesisPort } from '@embeddings/out-ports';
import { QueryMetadata } from '@embeddings/dtos';
import { GeminiClient } from './gemini.client';
import { AnalysisResult } from '@embeddings/dtos';
import {
  QueryClassificationPrompt,
  SemanticSynthesisPrompt,
  QueryReformulationSynthesisPrompt,
  HistorySummarizationSynthesisPrompt,
  GroundingVerificationPrompt,
  LogStyleTransformationPrompt,
} from 'src/embeddings/core/domain/prompts/implementations';
import { normalizeMetadata } from '@embeddings/utils';


/**
 * GeminiAdapter - Adapter that performs actual Gemini API operations
 * using the initialized client from GeminiClient.
 */
@Injectable()
export class GeminiAdapter extends SynthesisPort {
  private readonly logger = new Logger(GeminiAdapter.name);

  constructor(
    private readonly geminiClient: GeminiClient,
    private readonly queryClassificationPrompt: QueryClassificationPrompt,
    private readonly semanticPrompt: SemanticSynthesisPrompt,
    private readonly queryReformulationPrompt: QueryReformulationSynthesisPrompt,
    private readonly historySummarizationPrompt: HistorySummarizationSynthesisPrompt,
    private readonly groundingVerificationPrompt: GroundingVerificationPrompt,
    private readonly logStyleTransformationPrompt: LogStyleTransformationPrompt,
  ) {
    super();
  }

  /**
   * Single LLM call that classifies query intent and extracts all metadata.
   * templateId non-null → STATISTICAL; null → SEMANTIC.
   */
  async classifyAndExtract(
    query: string,
    initialMetadata?: Partial<QueryMetadata>,
  ): Promise<{ templateId: string | null; params: Record<string, any>; metadata: QueryMetadata }> {
    const emptyMetadata: QueryMetadata = {
      startTime: null,
      endTime: null,
      service: null,
      route: null,
      errorCode: null,
      hasError: false,
    };

    try {
      this.logger.log(`Classifying query and extracting metadata: "${query}"`);
      const prompt = this.queryClassificationPrompt.build({
        query,
        initialMetadata,
      });

      const jsonModel = this.geminiClient.getJsonModel();
      const result = await jsonModel.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      const parsed = JSON.parse(text);

      this.logger.debug(`Classification result: ${JSON.stringify(parsed)}`);

      const rawTemplateId =
        typeof parsed.templateId === 'string' && parsed.templateId !== 'null'
          ? parsed.templateId
          : null;

      const rawMeta = parsed.params?.metadata || {};

      // Merge initial metadata as fallback for fields the LLM left null
      if (initialMetadata) {
        if (!rawMeta.startTime && initialMetadata.startTime) {
          rawMeta.startTime =
            (initialMetadata.startTime as Date).toISOString?.() ??
            initialMetadata.startTime;
        }
        if (!rawMeta.endTime && initialMetadata.endTime) {
          rawMeta.endTime =
            (initialMetadata.endTime as Date).toISOString?.() ??
            initialMetadata.endTime;
        }
        if (!rawMeta.service && initialMetadata.service) {
          rawMeta.service = initialMetadata.service;
        }
        if (!rawMeta.route && initialMetadata.route) {
          rawMeta.route = initialMetadata.route;
        }
        if (!rawMeta.errorCode && initialMetadata.errorCode) {
          rawMeta.errorCode = initialMetadata.errorCode;
        }
        if (rawMeta.hasError === undefined && initialMetadata.hasError !== undefined) {
          rawMeta.hasError = initialMetadata.hasError;
        }
      }

      const metadata: QueryMetadata = normalizeMetadata({
        startTime: rawMeta.startTime ? new Date(String(rawMeta.startTime)) : null,
        endTime: rawMeta.endTime ? new Date(String(rawMeta.endTime)) : null,
        service: (rawMeta.service as string) || null,
        route: (rawMeta.route as string) || null,
        errorCode: (rawMeta.errorCode as string) || null,
        hasError: rawMeta.hasError === true || false,
      });

      this.logger.log(
        `Classification: templateId=${rawTemplateId ?? 'null'} (${rawTemplateId ? 'STATISTICAL' : 'SEMANTIC'})`,
      );

      return {
        templateId: rawTemplateId,
        params: { ...parsed.params, metadata },
        metadata,
      };
    } catch (error) {
      this.logger.error(`classifyAndExtract failed: ${error.message}. Falling back to SEMANTIC.`);
      return {
        templateId: null,
        params: { topN: 10, metadata: emptyMetadata },
        metadata: emptyMetadata,
      };
    }
  }

  async synthesize(
    query: string,
    contexts: any[] | { aggregationResults?: any; contextLogs?: any[] },
    history: any[] = [],
    targetLanguage?: 'Korean' | 'English',
  ): Promise<{ answer: string; confidence: number }> {
    try {
      const isAggregationResult =
        contexts &&
        typeof contexts === 'object' &&
        !Array.isArray(contexts) &&
        ('aggregationResults' in contexts || 'contextLogs' in contexts);

      let contextText: string;

      if (isAggregationResult) {
        const aggregationData = contexts as {
          aggregationResults?: any;
          contextLogs?: any[];
        };
        this.logger.log(
          `Synthesizing answer for aggregation query: "${query}" with ${aggregationData.aggregationResults?.length || 0} aggregation results and ${aggregationData.contextLogs?.length || 0} context logs`,
        );

        contextText = SemanticSynthesisPrompt.formatAggregationContexts({
          aggregationResults: aggregationData.aggregationResults,
          contextLogs: aggregationData.contextLogs,
        });
      } else {
        const contextsArray = contexts as any[];
        this.logger.log(
          `Synthesizing answer for semantic query: "${query}" with ${contextsArray.length} contexts`,
        );

        contextText = SemanticSynthesisPrompt.formatContexts(contextsArray);
      }

      const historyText = SemanticSynthesisPrompt.formatHistory(history);
      const detectedLanguage = targetLanguage || this.detectLanguage(query);
      const prompt = this.semanticPrompt.build({
        query,
        contextText,
        historyText,
        isAggregation: isAggregationResult,
        detectedLanguage,
      });

      this.logger.debug(
        `Language for synthesis: ${detectedLanguage} (Forced: ${!!targetLanguage})`,
      );

      const model = this.geminiClient.getModel();
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      const answerMatch = text.match(
        /Answer:\s*([\s\S]*?)(?=\nConfidence:|$)/i,
      );
      const confidenceMatch = text.match(/Confidence:\s*([\d.]+)/i);

      return {
        answer: answerMatch ? answerMatch[1].trim() : text,
        confidence: confidenceMatch ? parseFloat(confidenceMatch[1]) : 0.5,
      };
    } catch (error) {
      this.logger.error(`Synthesis failed: ${error.message}`);
      return {
        answer: `Error occurred while generating answer: ${error.message}`,
        confidence: 0,
      };
    }
  }

  async reformulateQuery(
    query: string,
    history: AnalysisResult[],
  ): Promise<string> {
    try {
      if (!history || history.length === 0) {
        return query;
      }

      const recentHistory = history.slice(-5);

      this.logger.debug(
        `Reformulating query: "${query}" with ${recentHistory.length} history turns`,
      );

      const historyText =
        QueryReformulationSynthesisPrompt.formatHistory(recentHistory);
      const prompt = this.queryReformulationPrompt.build({
        query,
        historyText,
      });

      const model = this.geminiClient.getModel();
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const reformulated = response.text().trim();

      if (!reformulated || reformulated.length === 0) {
        this.logger.warn(
          `Query reformulation returned empty, using original query`,
        );
        return query;
      }

      if (reformulated !== query) {
        this.logger.log(`Query reformulated: "${query}" → "${reformulated}"`);
      }

      return reformulated;
    } catch (error) {
      this.logger.error(
        `Query reformulation failed: ${error.message}, using original query`,
      );
      return query;
    }
  }

  async summarizeHistory(history: AnalysisResult[]): Promise<string> {
    try {
      if (!history || history.length === 0) {
        return '';
      }

      this.logger.debug(`Summarizing ${history.length} conversation turns`);

      const historyText =
        HistorySummarizationSynthesisPrompt.formatHistory(history);
      const prompt = this.historySummarizationPrompt.build({ historyText });

      const model = this.geminiClient.getModel();
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const summary = response.text().trim();

      if (!summary || summary.length === 0) {
        this.logger.warn(
          `History summarization returned empty, using simple summary`,
        );
        return HistorySummarizationSynthesisPrompt.createSimpleSummary(history);
      }

      return summary;
    } catch (error) {
      this.logger.error(
        `History summarization failed: ${error.message}, using simple summary`,
      );
      return HistorySummarizationSynthesisPrompt.createSimpleSummary(history);
    }
  }

  async verifyGrounding(
    query: string,
    answer: string,
    groundingContext: any[],
  ): Promise<{
    status: 'VERIFIED' | 'PARTIALLY_VERIFIED' | 'NOT_VERIFIED';
    confidenceAdjustment: number;
    unverifiedClaims: string[];
    action: 'KEEP_ANSWER' | 'ADJUST_CONFIDENCE' | 'REJECT_ANSWER';
    reasoning: string;
  }> {
    try {
      this.logger.log(
        `Verifying grounding for answer (length: ${answer.length}, context items: ${groundingContext.length})`,
      );

      const groundingContextText =
        GroundingVerificationPrompt.formatGroundingContext(groundingContext);
      const prompt = this.groundingVerificationPrompt.build({
        query,
        answer,
        groundingContext: groundingContextText,
      });

      const jsonModel = this.geminiClient.getJsonModel();
      const result = await jsonModel.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      let parsed: any;
      try {
        const jsonMatch =
          text.match(/```json\s*([\s\S]*?)\s*```/) ||
          text.match(/```\s*([\s\S]*?)\s*```/);
        const jsonText = jsonMatch ? jsonMatch[1] : text;
        parsed = JSON.parse(jsonText.trim());
      } catch (parseError) {
        // If JSON parsing fails, try to parse the raw text
        parsed = JSON.parse(text.trim());
      }

      // Validate and normalize the response
      const status = parsed.status || 'NOT_VERIFIED';
      const confidenceAdjustment = Math.max(
        0,
        Math.min(1, parsed.confidenceAdjustment ?? 0.5),
      );
      const unverifiedClaims = Array.isArray(parsed.unverifiedClaims)
        ? parsed.unverifiedClaims
        : [];
      const action = parsed.action || 'ADJUST_CONFIDENCE';
      const reasoning = parsed.reasoning || 'Verification completed';

      this.logger.log(
        `Grounding verification result: ${status}, confidence adjustment: ${confidenceAdjustment}, action: ${action}`,
      );

      if (unverifiedClaims.length > 0) {
        this.logger.warn(
          `Found ${unverifiedClaims.length} unverified claims: ${unverifiedClaims.join(', ')}`,
        );
      }

      return {
        status,
        confidenceAdjustment,
        unverifiedClaims,
        action,
        reasoning,
      };
    } catch (error) {
      this.logger.error(
        `Grounding verification failed: ${error.message}`,
        error.stack,
      );
      return {
        status: 'NOT_VERIFIED',
        confidenceAdjustment: 0.3,
        unverifiedClaims: ['Verification process failed'],
        action: 'ADJUST_CONFIDENCE',
        reasoning: `Verification error: ${error.message}`,
      };
    }
  }

  async transformQueryToLogStyle(query: string): Promise<string> {
    try {
      this.logger.log(`Transforming query to log-style narrative: "${query}"`);
      const prompt = this.logStyleTransformationPrompt.build({ query });

      const model = this.geminiClient.getModel();
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const transformed = response.text().trim();

      if (!transformed || transformed.length === 0) {
        this.logger.warn(
          `Log-style transformation returned empty, using original query`,
        );
        return query;
      }

      this.logger.log(`Query transformed to log-style: "${transformed}"`);
      return transformed;
    } catch (error) {
      this.logger.error(
        `Log-style transformation failed: ${error.message}, using original query`,
      );
      return query;
    }
  }

  /**
   * Simple language detection based on character sets.
   */
  detectLanguage(text: string): 'Korean' | 'English' {
    const koreanRegex = /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/;
    return koreanRegex.test(text) ? 'Korean' : 'English';
  }
}
