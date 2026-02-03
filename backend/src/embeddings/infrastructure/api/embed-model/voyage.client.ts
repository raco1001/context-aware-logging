import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VoyageAIClient } from 'voyageai';

/**
 * VoyageClient - Infrastructure client for initializing and managing the Voyage AI SDK client.
 * This class is responsible solely for client initialization and configuration.
 * Actual API operations are delegated to adapters that use this client instance.
 */
@Injectable()
export class VoyageClient {
  private readonly logger = new Logger(VoyageClient.name);
  private readonly client: VoyageAIClient;
  private readonly model: string;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('EMBEDDING_MODEL_KEY');
    this.model =
      this.configService.get<string>('EMBEDDING_MODEL') || 'voyage-3-lite';

    if (!apiKey) {
      this.logger.warn(
        'EMBEDDING_MODEL_KEY is not defined. Embedding operations will fail.',
      );
    }

    this.client = new VoyageAIClient({
      apiKey: apiKey || '',
    });

    this.logger.log(`Voyage AI client initialized with model: ${this.model}`);
  }

  /**
   * Returns the initialized Voyage AI client instance.
   * This is the single source of truth for the Voyage AI SDK client.
   */
  getClient(): VoyageAIClient {
    return this.client;
  }

  /**
   * Returns the configured model name.
   */
  getModelName(): string {
    return this.model;
  }
}
