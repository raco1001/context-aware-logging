import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GoogleGenerativeAI, GenerativeModel } from "@google/generative-ai";

/**
 * GeminiClient - Infrastructure client for initializing and managing the Google Generative AI SDK client.
 * This class is responsible solely for client initialization and configuration.
 * Actual API operations are delegated to adapters that use this client instance.
 */
@Injectable()
export class GeminiClient {
  private readonly logger = new Logger(GeminiClient.name);
  private readonly genAI: GoogleGenerativeAI;
  private readonly model: GenerativeModel;
  private readonly jsonModel: GenerativeModel;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>("RETRIEVING_MODEL_KEY");
    const modelName =
      this.configService.get<string>("RETRIEVING_MODEL") || "gemini-1.5-flash";

    if (!apiKey) {
      this.logger.warn(
        "RETRIEVING_MODEL_KEY is not defined. Synthesis operations will fail.",
      );
    }

    this.genAI = new GoogleGenerativeAI(apiKey || "");
    this.model = this.genAI.getGenerativeModel({ model: modelName });
    this.jsonModel = this.genAI.getGenerativeModel({
      model: modelName,
      generationConfig: { responseMimeType: "application/json" },
    });

    this.logger.log(`Gemini client initialized with model: ${modelName}`);
  }

  /**
   * Returns the initialized GenerativeModel instance for general text generation.
   */
  getModel(): GenerativeModel {
    return this.model;
  }

  /**
   * Returns the initialized GenerativeModel instance configured for JSON responses.
   */
  getJsonModel(): GenerativeModel {
    return this.jsonModel;
  }
}
