import { Injectable, Logger } from "@nestjs/common";
import { LogStoragePort } from "@embeddings/out-ports";
import { QueryMetadata } from "@embeddings/dtos";

/**
 * AggregationService - Handles statistical aggregations on log data.
 *
 * This service provides methods for aggregating log data using MongoDB aggregation pipelines.
 * It's used for statistical queries like "top N error codes", "error count by route", etc.
 */
@Injectable()
export class AggregationService {
  private readonly logger = new Logger(AggregationService.name);

  constructor(private readonly logStorage: LogStoragePort) {}

  /**
   * Aggregates error codes by count, returning top N error codes.
   *
   * @param metadata Query metadata containing time range and filters
   * @param topN Number of top error codes to return (default: 5)
   * @returns Array of error codes with their counts and example logs
   */
  async aggregateErrorCodesByCount(
    metadata: QueryMetadata,
    topN: number = 5,
  ): Promise<
    Array<{
      errorCode: string;
      count: number;
      examples: any[];
    }>
  > {
    this.logger.log(
      `Aggregating error codes by count (top ${topN}) with metadata: ${JSON.stringify(metadata)}`,
    );

    const matchStage: any = {
      "error.code": { $exists: true, $ne: null },
    };

    // Add time range filter if provided
    if (metadata.startTime || metadata.endTime) {
      matchStage.timestamp = {};
      if (metadata.startTime) {
        matchStage.timestamp.$gte = metadata.startTime;
      }
      if (metadata.endTime) {
        matchStage.timestamp.$lte = metadata.endTime;
      }
    }

    // Add service filter if provided
    if (metadata.service) {
      matchStage.service = metadata.service;
    }

    const pipeline = [
      // 1. Match documents with errors in the specified time range
      {
        $match: matchStage,
      },
      // 2. Group by error code
      {
        $group: {
          _id: "$error.code",
          count: { $sum: 1 },
          examples: {
            $push: {
              requestId: "$requestId",
              timestamp: "$timestamp",
              service: "$service",
              route: "$route",
              errorCode: "$error.code",
              errorMessage: "$error.message",
            },
          },
        },
      },
      // 3. Sort by count descending
      {
        $sort: { count: -1 },
      },
      // 4. Limit to top N
      {
        $limit: topN,
      },
      // 5. Reshape output
      {
        $project: {
          _id: 0,
          errorCode: "$_id",
          count: 1,
          examples: { $slice: ["$examples", 3] }, // Top 3 examples per error code
        },
      },
    ];

    try {
      const results = await this.logStorage.executeAggregation(
        pipeline,
        "wide_events",
      );
      this.logger.log(
        `Aggregation completed: ${results.length} error codes found`,
      );
      return results;
    } catch (error) {
      this.logger.error(
        `Error aggregation failed: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Aggregates errors by route, returning top N routes with most errors.
   *
   * @param metadata Query metadata containing time range and filters
   * @param topN Number of top routes to return (default: 5)
   * @returns Array of routes with their error counts
   */
  async aggregateErrorsByRoute(
    metadata: QueryMetadata,
    topN: number = 5,
  ): Promise<
    Array<{
      route: string;
      count: number;
      errorCodes: Array<{ code: string; count: number }>;
    }>
  > {
    this.logger.log(
      `Aggregating errors by route (top ${topN}) with metadata: ${JSON.stringify(metadata)}`,
    );

    const matchStage: any = {
      "error.code": { $exists: true, $ne: null },
    };

    if (metadata.startTime || metadata.endTime) {
      matchStage.timestamp = {};
      if (metadata.startTime) {
        matchStage.timestamp.$gte = metadata.startTime;
      }
      if (metadata.endTime) {
        matchStage.timestamp.$lte = metadata.endTime;
      }
    }

    if (metadata.service) {
      matchStage.service = metadata.service;
    }

    const pipeline = [
      { $match: matchStage },
      {
        $group: {
          _id: "$route",
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $limit: topN },
      {
        $project: {
          _id: 0,
          route: "$_id",
          count: 1,
          errorCodes: [], // Simplified - can be enhanced later if needed
        },
      },
    ];

    try {
      const results = await this.logStorage.executeAggregation(
        pipeline,
        "wide_events",
      );
      this.logger.log(
        `Route aggregation completed: ${results.length} routes found`,
      );
      return results;
    } catch (error) {
      this.logger.error(
        `Route aggregation failed: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Aggregates errors by service, returning error counts per service.
   *
   * @param metadata Query metadata containing time range and filters
   * @returns Array of services with their error counts
   */
  async aggregateErrorsByService(
    metadata: QueryMetadata,
  ): Promise<
    Array<{
      service: string;
      count: number;
      topErrorCodes: Array<{ code: string; count: number }>;
    }>
  > {
    this.logger.log(
      `Aggregating errors by service with metadata: ${JSON.stringify(metadata)}`,
    );

    const matchStage: any = {
      "error.code": { $exists: true, $ne: null },
    };

    if (metadata.startTime || metadata.endTime) {
      matchStage.timestamp = {};
      if (metadata.startTime) {
        matchStage.timestamp.$gte = metadata.startTime;
      }
      if (metadata.endTime) {
        matchStage.timestamp.$lte = metadata.endTime;
      }
    }

    const pipeline = [
      { $match: matchStage },
      {
        $group: {
          _id: "$service",
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      {
        $project: {
          _id: 0,
          service: "$_id",
          count: 1,
          topErrorCodes: [], // Simplified - can be enhanced later if needed
        },
      },
    ];

    try {
      const results = await this.logStorage.executeAggregation(
        pipeline,
        "wide_events",
      );
      this.logger.log(
        `Service aggregation completed: ${results.length} services found`,
      );
      return results;
    } catch (error) {
      this.logger.error(
        `Service aggregation failed: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }
}

