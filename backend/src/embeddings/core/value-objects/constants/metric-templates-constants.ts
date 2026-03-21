import { IMetricTemplate } from '@embeddings/types';
import { AggregationHelper } from '@embeddings/utils';

export const METRIC_TEMPLATES: Record<string, IMetricTemplate> = {
  TOP_ERROR_CODES: {
    id: 'TOP_ERROR_CODES',
    name: 'Top Error Codes',
    description: 'Ranks error codes by frequency of occurrence.',
    requiredParams: [],
    pipelineTemplate: (params) => [
      {
        $match: AggregationHelper.buildMatchStage(params.metadata, {
          'error.code': { $exists: true, $ne: null },
        }),
      },
      {
        $group: {
          _id: '$error.code',
          count: { $sum: 1 },
          examples: {
            $push: {
              requestId: '$requestId',
              timestamp: '$timestamp',
              service: '$service',
              route: '$route',
              errorMessage: '$error.message',
            },
          },
        },
      },
      { $sort: { count: -1 } },
      { $limit: params.topN || 5 },
      {
        $project: {
          _id: 0,
          errorCode: '$_id',
          count: 1,
          examples: { $slice: ['$examples', 3] },
        },
      },
    ],
  },
  ERROR_DISTRIBUTION_BY_ROUTE: {
    id: 'ERROR_DISTRIBUTION_BY_ROUTE',
    name: 'Error Distribution by Route',
    description: 'Analyzes which routes are producing the most errors.',
    requiredParams: [],
    pipelineTemplate: (params) => [
      {
        $match: AggregationHelper.buildMatchStage(params.metadata, {
          'error.code': { $exists: true, $ne: null },
        }),
      },
      {
        $group: {
          _id: '$route',
          count: { $sum: 1 },
          errorCodes: { $addToSet: '$error.code' },
        },
      },
      { $sort: { count: -1 } },
      { $limit: params.topN || 5 },
      {
        $project: {
          _id: 0,
          route: '$_id',
          count: 1,
          errorCodes: 1,
        },
      },
    ],
  },
  ERROR_BY_SERVICE: {
    id: 'ERROR_BY_SERVICE',
    name: 'Error by Service',
    description: 'Counts errors for each service.',
    requiredParams: [],
    pipelineTemplate: (params) => [
      {
        $match: AggregationHelper.buildMatchStage(params.metadata, {
          'error.code': { $exists: true, $ne: null },
        }),
      },
      {
        $group: {
          _id: '$service',
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      {
        $project: {
          _id: 0,
          service: '$_id',
          count: 1,
          topErrorCodes: [],
        },
      },
    ],
  },
  LATENCY_PERCENTILE: {
    id: 'LATENCY_PERCENTILE',
    name: 'Latency Percentile',
    description: 'Calculates P50, P95, and P99 latency for requests.',
    requiredParams: [],
    pipelineTemplate: (params) => [
      {
        $match: AggregationHelper.buildMatchStage(params.metadata, {
          'performance.durationMs': { $exists: true, $ne: null },
        }),
      },
      {
        $sort: { 'performance.durationMs': 1 },
      },
      {
        $group: {
          _id: null,
          durations: { $push: '$performance.durationMs' },
          count: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          count: 1,
          p50: {
            $arrayElemAt: [
              '$durations',
              { $floor: { $multiply: [0.5, '$count'] } },
            ],
          },
          p95: {
            $arrayElemAt: [
              '$durations',
              { $floor: { $multiply: [0.95, '$count'] } },
            ],
          },
          p99: {
            $arrayElemAt: [
              '$durations',
              { $floor: { $multiply: [0.99, '$count'] } },
            ],
          },
          avg: { $avg: '$durations' },
          max: { $max: '$durations' },
        },
      },
    ],
  },
  ERROR_RATE: {
    id: 'ERROR_RATE',
    name: 'Error Rate Analysis',
    description: 'Calculates the ratio of errors to total requests.',
    requiredParams: [],
    pipelineTemplate: (params) => {
      // Strip hasError/errorCode from match so the denominator includes ALL
      // requests in the time window. errorCount is derived inside $group.
      const { hasError: _h, errorCode: _e, ...baseMetadata } = params.metadata;
      const matchStage = AggregationHelper.buildMatchStage(baseMetadata);
      const start = baseMetadata.startTime;
      const end = baseMetadata.endTime;
      const mid =
        start && end
          ? new Date((start.getTime() + end.getTime()) / 2)
          : null;

      const seriesBucket = AggregationHelper.resolveSeriesTimeBucket(
        baseMetadata.startTime,
        baseMetadata.endTime,
      );

      const trendHalvesPipeline =
        start && end && mid
          ? [
              {
                $group: {
                  _id: {
                    $cond: [{ $lt: ['$timestamp', mid] }, 'first', 'second'],
                  },
                  totalCount: { $sum: 1 },
                  errorCount: {
                    $sum: {
                      $cond: [{ $ifNull: ['$error.code', false] }, 1, 0],
                    },
                  },
                },
              },
              {
                $project: {
                  _id: 1,
                  totalCount: 1,
                  errorCount: 1,
                  errorRatePct: {
                    $cond: [
                      { $gt: ['$totalCount', 0] },
                      {
                        $multiply: [
                          { $divide: ['$errorCount', '$totalCount'] },
                          100,
                        ],
                      },
                      0,
                    ],
                  },
                },
              },
            ]
          : [{ $match: { $expr: { $eq: [1, 0] } } }];

      return [
        { $match: matchStage },
        {
          $facet: {
            summary: [
              {
                $group: {
                  _id: null,
                  totalCount: { $sum: 1 },
                  errorCount: {
                    $sum: {
                      $cond: [{ $ifNull: ['$error.code', false] }, 1, 0],
                    },
                  },
                },
              },
              {
                $project: {
                  _id: 0,
                  totalCount: 1,
                  errorCount: 1,
                  errorRate: {
                    $cond: [
                      { $gt: ['$totalCount', 0] },
                      {
                        $multiply: [
                          { $divide: ['$errorCount', '$totalCount'] },
                          100,
                        ],
                      },
                      0,
                    ],
                  },
                },
              },
            ],
            series: [
              {
                $group: {
                  _id: {
                    $dateTrunc: {
                      date: '$timestamp',
                      unit: seriesBucket.unit,
                      timezone: 'UTC',
                      ...(seriesBucket.binSize != null && seriesBucket.binSize > 1
                        ? { binSize: seriesBucket.binSize }
                        : {}),
                    },
                  },
                  total: { $sum: 1 },
                  failed: {
                    $sum: {
                      $cond: [{ $ifNull: ['$error.code', false] }, 1, 0],
                    },
                  },
                },
              },
              { $sort: { _id: 1 } },
              {
                $project: {
                  _id: 0,
                  bucket: {
                    $dateToString: {
                      format: seriesBucket.dateToStringFormat,
                      date: '$_id',
                      timezone: 'UTC',
                    },
                  },
                  total: 1,
                  failed: 1,
                },
              },
            ],
            latency: [
              {
                $match: {
                  'performance.durationMs': { $exists: true, $ne: null },
                },
              },
              { $sort: { 'performance.durationMs': 1 } },
              {
                $group: {
                  _id: null,
                  durations: { $push: '$performance.durationMs' },
                  count: { $sum: 1 },
                },
              },
              {
                $project: {
                  _id: 0,
                  count: 1,
                  p50: {
                    $arrayElemAt: [
                      '$durations',
                      { $floor: { $multiply: [0.5, '$count'] } },
                    ],
                  },
                  p95: {
                    $arrayElemAt: [
                      '$durations',
                      { $floor: { $multiply: [0.95, '$count'] } },
                    ],
                  },
                  p99: {
                    $arrayElemAt: [
                      '$durations',
                      { $floor: { $multiply: [0.99, '$count'] } },
                    ],
                  },
                  avg: { $avg: '$durations' },
                  max: { $max: '$durations' },
                },
              },
            ],
            trendHalves: trendHalvesPipeline,
          },
        },
      ];
    },
  },
};
