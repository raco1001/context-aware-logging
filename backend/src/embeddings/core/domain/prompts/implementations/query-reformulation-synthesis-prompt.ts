import { PromptTemplate } from '../prompt-template';
import { PromptTemplateRegistry } from '../prompt-template-registry';
import { AnalysisResult } from '@embeddings/dtos';
import { QUERY_REFORMULATION_SYNTHESIS_FALLBACK } from 'src/embeddings/core/value-objects/fallbacks/prompts';
/**
 * QueryReformulationSynthesisPrompt - Query reformulation prompt template
 *
 * A prompt template for reformulating a query by resolving references based on chat history.
 */
export class QueryReformulationSynthesisPrompt extends PromptTemplate {
  private readonly fallbackTemplate = QUERY_REFORMULATION_SYNTHESIS_FALLBACK;

  constructor(private readonly registry: PromptTemplateRegistry) {
    super();
  }

  getType(): string {
    return 'query-reformulation';
  }

  build(params: { query: string; historyText: string }): string {
    const template =
      this.registry.getTemplateString(this.getType()) || this.fallbackTemplate;

    return template
      .replace('{{historyText}}', params.historyText)
      .replace('{{query}}', params.query);
  }

  /**
   * Converts history to a format suitable for use in a prompt.
   */
  static formatHistory(history: AnalysisResult[]): string {
    return history
      .map(
        (h, i) =>
          `Turn ${i + 1}:\nQ: ${h.question}\nA: ${h.answer.substring(0, 200)}${h.answer.length > 200 ? '...' : ''}`,
      )
      .join('\n\n');
  }
}
