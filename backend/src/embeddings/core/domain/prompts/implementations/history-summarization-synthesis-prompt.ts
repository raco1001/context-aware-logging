import { PromptTemplate } from "../prompt-template";
import { PromptTemplateRegistry } from "../prompt-template-registry";
import { AnalysisResult } from "@embeddings/dtos";
import { HISTORY_SUMMARIZATION_FALLBACK } from "@embeddings/value-objects/fallbacks/prompts";
/**
 * HistorySummarizationSynthesisPrompt - History summarization prompt template
 *
 * A prompt template for summarizing a long conversation history to manage the context window.
 */
export class HistorySummarizationSynthesisPrompt extends PromptTemplate {
  private readonly fallbackTemplate = HISTORY_SUMMARIZATION_FALLBACK;

  constructor(private readonly registry: PromptTemplateRegistry) {
    super();
  }

  getType(): string {
    return "history-summarization";
  }

  build(params: { historyText: string }): string {
    const template =
      this.registry.getTemplateString(this.getType()) || this.fallbackTemplate;

    return template.replace("{{historyText}}", params.historyText);
  }

  /**
   * Converts history to a format suitable for use in a prompt.
   */
  static formatHistory(history: AnalysisResult[]): string {
    return history
      .map(
        (h, i) =>
          `Q${i + 1}: ${h.question}\nA${i + 1}: ${h.answer.substring(0, 150)}${h.answer.length > 150 ? "..." : ""}`,
      )
      .join("\n\n");
  }

  /**
   * Creates a simple summary when LLM summarization fails.
   */
  static createSimpleSummary(history: AnalysisResult[]): string {
    const topics = new Set<string>();
    const errors = new Set<string>();

    for (const h of history) {
      // Extract potential topics from questions
      if (
        h.question.includes("에러") ||
        h.question.toLowerCase().includes("error")
      ) {
        errors.add("errors");
      }
      if (
        h.question.includes("서비스") ||
        h.question.toLowerCase().includes("service")
      ) {
        topics.add("services");
      }
      if (
        h.question.includes("성능") ||
        h.question.toLowerCase().includes("performance")
      ) {
        topics.add("performance");
      }
    }

    const topicList = Array.from(topics).join(", ");
    return `Previous conversation covered ${history.length} interactions about ${topicList || "various topics"}.`;
  }
}
