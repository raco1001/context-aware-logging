import { AnalysisIntent } from '@embeddings/value-objects/filter';

export interface QueryMetadata {
  startTime: Date | null;
  endTime: Date | null;
  service: string | null;
  route: string | null;
  errorCode: string | null;
  hasError: boolean;
  /** LLM intent classification (piggyback on extractMetadata) */
  intent?: AnalysisIntent;
  /** 0.0–1.0; used with HybridIntentClassifier threshold */
  intentConfidence?: number;
}
