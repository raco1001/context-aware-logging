import { AnalysisResult } from "@embeddings/domain";

export abstract class SessionCacheDto {
  history: AnalysisResult[];
  lastAccessed: Date;
  ttl: number;
}

// Map<string, SessionCacheDto>();
export abstract class ActiveSessionCacheDto extends Map<
  string,
  SessionCacheDto
> {
  constructor() {
    super();
  }
}
