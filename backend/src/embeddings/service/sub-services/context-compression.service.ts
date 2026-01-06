import { Injectable, Logger } from "@nestjs/common";
import { SynthesisPort } from "@embeddings/out-ports";
import { AnalysisResult } from "@embeddings/dtos";
import { AnalysisIntent } from "@embeddings/value-objects/filter";

/**
 * ContextCompressionService - Compresses long chat history to manage context window.
 *
 * This service summarizes old conversation history to reduce token usage
 * while preserving important context for LLM synthesis.
 *
 * Strategy:
 * - Keep recent N turns as-is (default: 10)
 * - Summarize older turns into a single summary message
 * - This reduces LLM token costs while maintaining conversation context
 */
@Injectable()
export class ContextCompressionService {
  private readonly logger = new Logger(ContextCompressionService.name);
  private readonly defaultMaxTurns = 10; // Keep last 10 turns as-is

  constructor(private readonly synthesisPort: SynthesisPort) {}

  /**
   * Compresses chat history by keeping recent turns and summarizing older ones.
   *
   * @param history Full chat history
   * @param maxTurns Maximum number of recent turns to keep as-is
   * @returns Compressed history (summary + recent turns)
   */
  async compressHistory(
    history: AnalysisResult[],
    maxTurns: number = this.defaultMaxTurns,
  ): Promise<AnalysisResult[]> {
    // If history is short enough, return as-is
    if (history.length <= maxTurns) {
      return history;
    }

    this.logger.debug(
      `Compressing history: ${history.length} turns → keeping last ${maxTurns} turns`,
    );

    // Split into old and recent
    const recent = history.slice(-maxTurns);
    const old = history.slice(0, -maxTurns);

    // Summarize old conversation
    const summary = await this.summarizeHistory(old);

    // Create summary result
    const summaryResult: AnalysisResult = {
      question: "[Previous conversation summary]",
      answer: summary,
      intent: AnalysisIntent.UNKNOWN,
      sources: this.extractSourcesFromHistory(old),
      confidence: 0.8,
      sessionId: recent[0]?.sessionId || "",
      createdAt: new Date(),
    };

    // Return summary + recent turns
    return [summaryResult, ...recent];
  }

  /**
   * Summarizes old conversation history into a concise summary.
   */
  private async summarizeHistory(
    oldHistory: AnalysisResult[],
  ): Promise<string> {
    if (oldHistory.length === 0) {
      return "";
    }

    try {
      // Use SynthesisPort interface method for summarization
      // The adapter handles fallback internally if summarization fails
      return await this.synthesisPort.summarizeHistory(oldHistory);
    } catch (error) {
      this.logger.error(
        `History summarization failed: ${error.message}, returning empty summary`,
      );
      // Return a basic fallback summary
      return `Previous conversation covered ${oldHistory.length} interactions.`;
    }
  }

  /**
   * Extracts unique sources from history.
   */
  private extractSourcesFromHistory(history: AnalysisResult[]): string[] {
    const sourcesSet = new Set<string>();
    for (const h of history) {
      if (h.sources) {
        h.sources.forEach((s) => sourcesSet.add(s));
      }
    }
    return Array.from(sourcesSet);
  }
}
