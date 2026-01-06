import { AnalysisIntent } from "@embeddings/value-objects/filter";
export interface AnalysisResult {
  sessionId?: string;
  question: string;
  intent: AnalysisIntent;
  answer: string;
  sources: string[]; // List of requestIds used as evidence
  confidence: number;
  createdAt?: Date;
}
