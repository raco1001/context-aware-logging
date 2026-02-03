import { AnalysisResult } from './analysis-result';

export interface SessionCacheDto {
  history: AnalysisResult[];
  lastAccessed: Date;
  ttl: number;
}
