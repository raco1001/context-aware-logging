import { PromptTemplate } from "../prompt-template.vo";
import { PromptTemplateRegistry } from "../prompt-template-registry";
import { AnalysisResult } from "@embeddings/domain";
import { SEMANTIC_SYNTHESIS_FALLBACK } from "./fallbacks";
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
  }): string {
    const template =
      this.registry.getTemplateString(this.getType()) || this.fallbackTemplate;

    const contextType = params.isAggregation
      ? "aggregation results and log contexts"
      : "log contexts";

    const contextSection = params.isAggregation
      ? "[Aggregation Results and Context Logs]"
      : "[Log Contexts]";

    return template
      .replace("{{contextType}}", contextType)
      .replace("{{query}}", params.query)
      .replace("{{historyText}}", params.historyText)
      .replace("{{contextSection}}", contextSection)
      .replace("{{contextText}}", params.contextText);
  }

  /**
   * Converts history to a format suitable for use in a prompt.
   */
  static formatHistory(history: AnalysisResult[]): string {
    if (history.length === 0) return "";

    return `\nChat History:\n${history
      .map(
        (h, i) =>
          `Turn ${i + 1}:\nQ: ${h.question}\nA: ${h.answer.substring(0, 200)}${h.answer.length > 200 ? "..." : ""}`,
      )
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
