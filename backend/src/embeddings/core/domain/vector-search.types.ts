export interface VectorSearchResult {
  eventId: unknown;
  summary: string;
  score: number;
  service?: string;
  timestamp?: Date;
  route?: string;
  hasError?: boolean;
  errorCode?: string;
  outcome?: string;
  failedAt?: string;
}

export interface RawLogDocument {
  _id: unknown;
  requestId: string;
  timestamp: Date;
  service: string;
  route: string;
  error?: { code: string; message: string };
  failedAt?: string;
  stepsReached?: number;
  performance?: {
    durationMs: number;
    balanceCheckMs?: number;
    gatewayMs?: number;
    orderConfirmationMs?: number;
  };
}

