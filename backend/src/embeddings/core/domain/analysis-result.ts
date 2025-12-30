export enum AnalysisIntent {
  STATISTICAL = 'STATISTICAL',
  SEMANTIC = 'SEMANTIC',
  UNKNOWN = 'UNKNOWN',
}

export interface AnalysisResult {
  sessionId?: string;
  question: string;
  intent: AnalysisIntent;
  answer: string;
  sources: string[]; // List of requestIds used as evidence
  confidence: number;
}
