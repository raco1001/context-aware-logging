import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmbeddingUseCase } from '@embeddings/in-ports';
import { EmbeddingPort, LogStoragePort } from '@embeddings/out-ports';
import { chunkByFields, shouldChunk, Chunk } from '../core/utils/chunking.util';
import { SummaryEnrichmentService } from './sub-services/summary-enrichment.service';

/**
 * EmbeddingService - Service for embedding operations.
 * Handles batch embedding and search requests.
 */
@Injectable()
export class EmbeddingService extends EmbeddingUseCase {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly batchChunkSize: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly logStoragePort: LogStoragePort,
    private readonly embeddingPort: EmbeddingPort,
    private readonly summaryEnrichment: SummaryEnrichmentService,
  ) {
    super();
    this.batchChunkSize = parseInt(
      this.configService.get<string>('EMBEDDING_BATCH_CHUNK_SIZE') || '50',
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
    const source = 'wide_events';
    this.logger.log(
      `Starting High-Watermark embedding process (Source: ${source}, Limit: ${limit}, Chunk Size: ${this.batchChunkSize})`,
    );

    const watermark = await this.logStoragePort.getWatermark(source);

    const logsToEmbed = await this.logStoragePort.findLogsAfterWatermark(
      source,
      watermark,
      limit,
    );

    if (logsToEmbed.length === 0) {
      this.logger.log('No new logs found for embedding after watermark.');
      return 0;
    }

    let processedCount = 0;

    for (let i = 0; i < logsToEmbed.length; i += this.batchChunkSize) {
      const chunk = logsToEmbed.slice(i, i + this.batchChunkSize);

      try {
        this.logger.log(`Processing chunk of ${chunk.length} logs...`);

        const chunksToEmbed: Array<{
          log: (typeof chunk)[0];
          chunk: Chunk;
        }> = [];

        for (const log of chunk) {
          const dualLayerSummary = log.wideEvent
            ? this.summaryEnrichment.generateDualLayerSummary(log.wideEvent)
            : log.summary;

          if (shouldChunk(dualLayerSummary, 200)) {
            const fieldChunks = chunkByFields(dualLayerSummary);
            // For now, we'll embed the full summary but keep chunking logic ready
            // Future: Can implement multi-chunk embedding if needed
            chunksToEmbed.push({
              log,
              chunk: { text: dualLayerSummary },
            });
          } else {
            // Short summary: embed as-is
            chunksToEmbed.push({
              log,
              chunk: { text: dualLayerSummary },
            });
          }
        }

        const summaries = chunksToEmbed.map((item) => item.chunk.text);
        const results =
          await this.embeddingPort.createBatchEmbeddings(summaries);

        const resultsToSave = chunksToEmbed.map((item, index) => ({
          eventId: item.log.internalId,
          requestId: item.log.requestId,
          summary: item.chunk.text, // Store Dual-layer Summary (narrative + canonical)
          embedding: results[index].embedding,
          model: results[index].model,
          service: item.log.service,
          timestamp: item.log.timestamp,
        }));

        const lastLog = chunk[chunk.length - 1];
        const newWatermark = {
          lastEventId: lastLog.internalId,
          lastEventTimestamp: lastLog.timestamp,
        };

        await this.logStoragePort.saveEmbeddingsAndUpdateWatermark(
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

  /**
   * Performs semantic search using vector similarity.
   */
  async search(query: string, limit: number = 5): Promise<any[]> {
    this.logger.log(`Searching for semantic matches: "${query}"`);

    const { embedding } = await this.embeddingPort.createEmbedding(query);

    return this.logStoragePort.vectorSearch(embedding, limit);
  }

  /**
   * Manually triggers embedding for a specific request ID.
   */
  async embedByRequestId(requestId: string): Promise<void> {
    this.logger.warn(`Single log embedding for ${requestId} requested`);
  }
}
