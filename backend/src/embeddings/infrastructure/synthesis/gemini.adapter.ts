import { Injectable, Logger } from "@nestjs/common";
import { SynthesisPort } from "@embeddings/out-ports";
import { QueryMetadata } from "@embeddings/dtos";
import { GeminiClient } from "./gemini.client";
import { AnalysisResult } from "@embeddings/domain";
import {
  QueryMetadataSynthesisPrompt,
  SemanticSynthesisPrompt,
  QueryReformulationSynthesisPrompt,
  HistorySummarizationSynthesisPrompt,
} from "src/embeddings/core/value-objects/prompts/synthesis";

/**
 * GeminiAdapter - Adapter that performs actual Gemini API operations
 * using the initialized client from GeminiClient.
 */
@Injectable()
export class GeminiAdapter extends SynthesisPort {
  private readonly logger = new Logger(GeminiAdapter.name);

  constructor(
    private readonly geminiClient: GeminiClient,
    private readonly queryMetadataPrompt: QueryMetadataSynthesisPrompt,
    private readonly semanticPrompt: SemanticSynthesisPrompt,
    private readonly queryReformulationPrompt: QueryReformulationSynthesisPrompt,
    private readonly historySummarizationPrompt: HistorySummarizationSynthesisPrompt,
  ) {
    super();
  }

  async extractMetadata(query: string): Promise<QueryMetadata> {
    try {
      this.logger.log(`Extracting metadata from query: "${query}"`);
      const prompt = this.queryMetadataPrompt.build({ query });

      const jsonModel = this.geminiClient.getJsonModel();
      const result = await jsonModel.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      const parsed = JSON.parse(text);
      this.logger.debug(`Extracted metadata: ${JSON.stringify(parsed)}`);
      return {
        startTime: parsed.startTime ? new Date(parsed.startTime) : null,
        endTime: parsed.endTime ? new Date(parsed.endTime) : null,
        service: parsed.service || null,
        route: parsed.route || null,
        errorCode: parsed.errorCode || null,
        hasError: parsed.hasError === true || false,
      };
    } catch (error) {
      this.logger.error(`Metadata extraction failed: ${error.message}`);
      return {
        startTime: null,
        endTime: null,
        service: null,
        route: null,
        errorCode: null,
        hasError: false,
      };
    }
  }

  async synthesize(
    query: string,
    contexts: any[] | { aggregationResults?: any; contextLogs?: any[] },
    history: any[] = [],
  ): Promise<{ answer: string; confidence: number }> {
    try {
      // Check if contexts is aggregation results or regular log contexts
      const isAggregationResult =
        contexts &&
        typeof contexts === "object" &&
        !Array.isArray(contexts) &&
        ("aggregationResults" in contexts || "contextLogs" in contexts);

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
      const prompt = this.semanticPrompt.build({
        query,
        contextText,
        historyText,
        isAggregation: isAggregationResult,
      });

      const model = this.geminiClient.getModel();
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      // Simple parsing of the expected format
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
      // If no history, return original query
      if (!history || history.length === 0) {
        return query;
      }

      // Use recent history (last 5 turns) for context
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

      // If reformulation failed or returned empty, use original query
      if (!reformulated || reformulated.length === 0) {
        this.logger.warn(
          `Query reformulation returned empty, using original query`,
        );
        return query;
      }

      // Log if query was actually changed
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
        return "";
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
}
