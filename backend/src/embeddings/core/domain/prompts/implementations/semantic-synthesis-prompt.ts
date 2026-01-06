import { PromptTemplate } from "../prompt-template.vo";
import { PromptTemplateRegistry } from "../prompt-template-registry";
import { AnalysisResult } from "@embeddings/dtos";
import { SEMANTIC_SYNTHESIS_FALLBACK } from "src/embeddings/core/value-objects/fallbacks/prompts";
/**
 * SemanticSynthesisPrompt - Semantic query synthesis prompt template
 *
 * A prompt template for generating a natural language answer based on the searched log contexts.
 */
export class SemanticSynthesisPrompt extends PromptTemplate {
  private readonly fallbackTemplate = SEMANTIC_SYNTHESIS_FALLBACK;

  constructor(private readonly registry: PromptTemplateRegistry) {
    super();
  }

  getType(): string {
    return "semantic-synthesis";
  }

  build(params: {
    query: string;
    contextText: string;
    historyText: string;
    isAggregation: boolean;
    detectedLanguage?: string;
  }): string {
    const template =
      this.registry.getTemplateString(this.getType()) || this.fallbackTemplate;

    const contextType = params.isAggregation
      ? "aggregation results and log contexts"
      : "log contexts";

    const contextSection = params.isAggregation
      ? "[Aggregation Results and Context Logs]"
      : "[Log Contexts]";

    let built = template
      .replace("{{contextType}}", contextType)
      .replace("{{query}}", params.query)
      .replace("{{historyText}}", params.historyText)
      .replace("{{contextSection}}", contextSection)
      .replace("{{contextText}}", params.contextText);

    if (params.detectedLanguage) {
      built += `\n\n[STRICT RULE: ANSWER IN ${params.detectedLanguage} ONLY]`;
    }

    return built;
  }

  /**
   * Converts history to a format suitable for use in a prompt.
   */
  static formatHistory(history: AnalysisResult[]): string {
    if (history.length === 0) return "";

    const now = new Date();

    return `\nChat History (Ordered from oldest to most recent):\n${history
      .map((h, i) => {
        const createdAt = h.createdAt ? new Date(h.createdAt) : null;
        const timeStr =
          createdAt && !isNaN(createdAt.getTime())
            ? ` [${Math.round((now.getTime() - createdAt.getTime()) / 60000)} mins ago]`
            : "";
        const turnLabel = i === history.length - 1 ? " (LAST TURN)" : "";
        return `Turn ${i + 1}${timeStr}${turnLabel}:\nQ: ${h.question}\nA: ${h.answer.substring(0, 200)}${h.answer.length > 200 ? "..." : ""}`;
      })
      .join("\n\n")}`;
  }

  /**
   * Converts contexts to a format suitable for use in a prompt.
   */
  static formatContexts(contexts: any[]): string {
    return contexts
      .map((ctx, i) => `[Document ${i + 1}]\n${JSON.stringify(ctx, null, 2)}`)
      .join("\n\n");
  }

  /**
   * Converts aggregation results and context logs to a format suitable for use in a prompt.
   */
  static formatAggregationContexts(params: {
    aggregationResults?: any[];
    contextLogs?: any[];
  }): string {
    const aggregationText = params.aggregationResults
      ? `[Aggregation Results]\n${JSON.stringify(params.aggregationResults, null, 2)}`
      : "";

    const contextLogsText = params.contextLogs
      ? params.contextLogs
          .map(
            (ctx, i) =>
              `[Context Log ${i + 1}]\n${JSON.stringify(ctx, null, 2)}`,
          )
          .join("\n\n")
      : "";

    return [aggregationText, contextLogsText].filter(Boolean).join("\n\n");
  }
}
