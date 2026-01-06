import { QueryMetadata } from '../dtos/query-metadata';

export class AggregationHelper {
  static buildMatchStage(metadata: QueryMetadata, extraFilters: any = {}): any {
    const match: any = { ...extraFilters };

    if (metadata.startTime || metadata.endTime) {
      match.timestamp = {};
      if (metadata.startTime) match.timestamp.$gte = new Date(metadata.startTime);
      if (metadata.endTime) match.timestamp.$lte = new Date(metadata.endTime);
    }

    if (metadata.service) {
      match.service = metadata.service;
    }

    if (metadata.route) {
      match.route = metadata.route;
    }

    if (metadata.errorCode) {
      match['error.code'] = metadata.errorCode;
    }

    if (metadata.hasError !== undefined) {
      if (metadata.hasError) {
        match['error.code'] = { $exists: true, $ne: null };
      } else {
        match['error.code'] = null;
      }
    }

    return match;
  }
}
