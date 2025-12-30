import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EmbeddingUseCase } from "@embeddings/in-ports";
import { EmbeddingPort, LogStoragePort } from "@embeddings/out-ports";

@Injectable()
export class EmbeddingService extends EmbeddingUseCase {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly batchChunkSize: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly logStorage: LogStoragePort,
    private readonly embeddingPort: EmbeddingPort,
  ) {
    super();
    this.batchChunkSize = parseInt(
      this.configService.get<string>("EMBEDDING_BATCH_CHUNK_SIZE") || "50",
      10,
    );
  }

  /**
   * Processes a batch of logs that have not yet been embedded.
   * @param limit The maximum number of logs to process in this batch.
   * @returns The number of successfully processed logs.
   * @throws An error if the batch processing fails.
   */
  async processPendingLogs(limit: number): Promise<number> {
    const source = "wide_events";
    this.logger.log(
      `Starting High-Watermark embedding process (Source: ${source}, Limit: ${limit}, Chunk Size: ${this.batchChunkSize})`,
    );

    const watermark = await this.logStorage.getWatermark(source);

    const logsToEmbed = await this.logStorage.findLogsAfterWatermark(
      source,
      watermark,
      limit,
    );

    if (logsToEmbed.length === 0) {
      this.logger.log("No new logs found for embedding after watermark.");
      return 0;
    }

    let processedCount = 0;

    for (let i = 0; i < logsToEmbed.length; i += this.batchChunkSize) {
      const chunk = logsToEmbed.slice(i, i + this.batchChunkSize);
      const summaries = chunk.map((log) => log.summary);

      try {
        this.logger.log(`Processing chunk of ${chunk.length} logs...`);
        const results =
          await this.embeddingPort.createBatchEmbeddings(summaries);

        const resultsToSave = chunk.map((log, index) => ({
          eventId: log.internalId,
          requestId: log.requestId,
          summary: log.summary,
          embedding: results[index].embedding,
          model: results[index].model,
          service: log.service,
          timestamp: log.timestamp,
        }));

        const lastLog = chunk[chunk.length - 1];
        const newWatermark = {
          lastEventId: lastLog.internalId,
          lastEventTimestamp: lastLog.timestamp,
        };

        await this.logStorage.saveEmbeddingsAndUpdateWatermark(
          source,
          resultsToSave,
          newWatermark,
        );

        processedCount += chunk.length;
        this.logger.log(
          `Successfully processed and updated watermark up to ${newWatermark.lastEventTimestamp.toISOString()}`,
        );

        if (i + this.batchChunkSize < logsToEmbed.length) {
          this.logger.log(`Respecting Rate Limits: waiting 500ms...`);
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      } catch (error) {
        this.logger.error(
          `Batch processing failed at chunk index ${i}: ${error.message}`,
        );
        break;
      }
    }

    this.logger.log(
      `Embedding process finished. Total processed: ${processedCount}`,
    );
    return processedCount;
  }

  async search(query: string, limit: number = 5): Promise<any[]> {
    this.logger.log(`Searching for semantic matches: "${query}"`);

    const { embedding } = await this.embeddingPort.createEmbedding(query);

    return this.logStorage.vectorSearch(embedding, limit);
  }

  async embedByRequestId(requestId: string): Promise<void> {
    this.logger.warn(`Single log embedding for ${requestId} requested`);
  }
}
