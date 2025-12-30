import { Injectable, Logger } from "@nestjs/common";
import { SynthesisPort } from "@embeddings/out-ports/index";
import { QueryMetadata } from "@embeddings/dtos/index";
import {
  RULES,
  OUTPUT_FORMAT,
  INSTRUCTIONS,
} from "@embeddings/value-objects/index";
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
        errorCode: parsed.errorCode || null,
        hasError: parsed.hasError === true || false,
      };
    } catch (error) {
      this.logger.error(`Metadata extraction failed: ${error.message}`);
      return {
        startTime: null,
        endTime: null,
        service: null,
        errorCode: null,
        hasError: false,
      };
    }
  }

  async synthesize(
    query: string,
    contexts: any[],
    history: any[] = [],
  ): Promise<{ answer: string; confidence: number }> {
    try {
      this.logger.log(
        `Synthesizing answer for query: "${query}" with ${contexts.length} contexts`,
      );

      const contextText = contexts
        .map((ctx, i) => `[Document ${i + 1}]\n${JSON.stringify(ctx, null, 2)}`)
        .join("\n\n");

      const historyText =
        history.length > 0
          ? `\nChat History:\n${history.map((h) => `${h.role}: ${h.content}`).join("\n")}`
          : "";
      const rules = RULES;
      const outputFormat = OUTPUT_FORMAT;
      const prompt = `
        You are an expert SRE and Log Analysis Assistant.
        Your goal is to answer the user's question based STRICTLY on the provided log contexts.

        [Rules]
        ${rules}

        [Question]
        ${query}
        ${historyText}

        [Log Contexts]
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
