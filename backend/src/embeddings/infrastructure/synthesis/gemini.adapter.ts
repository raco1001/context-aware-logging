import { Injectable, Logger } from "@nestjs/common";
import { SynthesisPort } from "@embeddings/out-ports";
import { QueryMetadata } from "@embeddings/dtos";
import { RULES, OUTPUT_FORMAT, INSTRUCTIONS } from "@embeddings/value-objects";
import { GeminiClient } from "./gemini.client";

/**
 * GeminiAdapter - Adapter that performs actual Gemini API operations
 * using the initialized client from GeminiClient.
 */
@Injectable()
export class GeminiAdapter extends SynthesisPort {
  private readonly logger = new Logger(GeminiAdapter.name);

  constructor(private readonly geminiClient: GeminiClient) {
    super();
  }

  async extractMetadata(query: string): Promise<QueryMetadata> {
    try {
      this.logger.log(`Extracting metadata from query: "${query}"`);
      const now = new Date();

      const prompt = `
        Extract query metadata for log searching. 
        Current Time: ${now.toISOString()}

        [Query]
        ${query}

        [Instructions]
        ${INSTRUCTIONS}

        `;

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
      let contextType: string;

      if (isAggregationResult) {
        const aggregationData = contexts as {
          aggregationResults?: any;
          contextLogs?: any[];
        };
        contextType = "aggregation";
        this.logger.log(
          `Synthesizing answer for aggregation query: "${query}" with ${aggregationData.aggregationResults?.length || 0} aggregation results and ${aggregationData.contextLogs?.length || 0} context logs`,
        );

        // Format aggregation results
        const aggregationText = aggregationData.aggregationResults
          ? `[Aggregation Results]\n${JSON.stringify(aggregationData.aggregationResults, null, 2)}`
          : "";

        // Format context logs if available
        const contextLogsText = aggregationData.contextLogs
          ? aggregationData.contextLogs
              .map(
                (ctx, i) =>
                  `[Context Log ${i + 1}]\n${JSON.stringify(ctx, null, 2)}`,
              )
              .join("\n\n")
          : "";

        contextText = [aggregationText, contextLogsText]
          .filter(Boolean)
          .join("\n\n");
      } else {
        contextType = "semantic";
        const contextsArray = contexts as any[];
        this.logger.log(
          `Synthesizing answer for semantic query: "${query}" with ${contextsArray.length} contexts`,
        );

        contextText = contextsArray
          .map((ctx, i) => `[Document ${i + 1}]\n${JSON.stringify(ctx, null, 2)}`)
          .join("\n\n");
      }

      const historyText =
        history.length > 0
          ? `\nChat History:\n${history.map((h) => `${h.role}: ${h.content}`).join("\n")}`
          : "";
      const rules = RULES;
      const outputFormat = OUTPUT_FORMAT;

      // Add aggregation-specific instructions
      const aggregationInstructions =
        contextType === "aggregation"
          ? `
        [Aggregation Instructions]
        - The provided data contains statistical aggregation results (e.g., error code counts, top N analysis).
        - Present the results in a clear, structured format (e.g., numbered list, table).
        - For each aggregated item, provide:
          1. The main metric (e.g., error code name)
          2. The count/frequency
          3. Brief explanation based on example logs if available
        - Use Korean if the question is in Korean, English if the question is in English.
        - Be concise but informative.
        `
          : "";

      const prompt = `
        You are an expert SRE and Log Analysis Assistant.
        Your goal is to answer the user's question based STRICTLY on the provided ${contextType === "aggregation" ? "aggregation results and log contexts" : "log contexts"}.

        [Rules]
        ${rules}
        ${aggregationInstructions}

        [Question]
        ${query}
        ${historyText}

        ${contextType === "aggregation" ? "[Aggregation Results and Context Logs]" : "[Log Contexts]"}
        ${contextText}

        [Output Format]
        ${outputFormat}
        `;

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
        answer: `답변 생성 중 오류가 발생했습니다: ${error.message}`,
        confidence: 0,
      };
    }
  }
}
