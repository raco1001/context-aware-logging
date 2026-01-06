import { Injectable, Logger } from "@nestjs/common";
import { LogStoragePort } from "@embeddings/out-ports";
import { QueryMetadata } from "@embeddings/dtos";
import { METRIC_TEMPLATES } from "@embeddings/value-objects/constants";

/**
 * AggregationService - Handles statistical aggregations on log data.
 *
 * This service provides methods for aggregating log data using MongoDB aggregation pipelines.
 * It's used for statistical queries like "top N error codes", "error count by route", etc.
 */
@Injectable()
export class AggregationService {
  private readonly logger = new Logger(AggregationService.name);

  constructor(private readonly logStoragePort: LogStoragePort) {}

  /**
   * Executes a metric template by ID with the provided parameters.
   *
   * @param templateId The ID of the template in METRIC_TEMPLATES
   * @param params Parameters to pass to the template pipeline function
   * @returns Aggregation results
   */
  async executeTemplate(
    templateId: string,
    params: Record<string, any>,
  ): Promise<any[]> {
    const template = METRIC_TEMPLATES[templateId];
    if (!template) {
      this.logger.error(`Template not found: ${templateId}`);
      throw new Error(`Metric template ${templateId} not found`);
    }

    this.logger.log(
      `Executing metric template: ${template.name} (${templateId})`,
    );

    const pipeline = template.pipelineTemplate(params);

    try {
      const results = await this.logStoragePort.executeAggregation(
        pipeline,
        "wide_events",
      );
      this.logger.log(
        `Template execution completed: ${results.length} results found`,
      );
      return results;
    } catch (error) {
      this.logger.error(
        `Template execution failed (${templateId}): ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Aggregates error codes by count, returning top N error codes.
   */
  async aggregateErrorCodesByCount(
    metadata: QueryMetadata,
    topN: number = 5,
  ): Promise<any[]> {
    return this.executeTemplate("TOP_ERROR_CODES", { metadata, topN });
  }

  /**
   * Aggregates errors by route, returning top N routes with most errors.
   */
  async aggregateErrorsByRoute(
    metadata: QueryMetadata,
    topN: number = 5,
  ): Promise<any[]> {
    return this.executeTemplate("ERROR_DISTRIBUTION_BY_ROUTE", {
      metadata,
      topN,
    });
  }

  /**
   * Aggregates errors by service, returning error counts per service.
   */
  async aggregateErrorsByService(metadata: QueryMetadata): Promise<any[]> {
    return this.executeTemplate("ERROR_BY_SERVICE", { metadata });
  }
}
