import { PromptTemplate } from "../prompt-template";
import { PromptTemplateRegistry } from "../prompt-template-registry";
import { GROUNDING_VERIFICATION_FALLBACK } from "@embeddings/value-objects/fallbacks/prompts";

/**
 * GroundingVerificationPrompt - Grounding verification prompt template
 *
 * A prompt template for verifying that generated answers are strictly supported
 * by the provided grounding context (log data) to prevent hallucinations.
 */
export class GroundingVerificationPrompt extends PromptTemplate {
  private readonly fallbackTemplate = GROUNDING_VERIFICATION_FALLBACK;

  constructor(private readonly registry: PromptTemplateRegistry) {
    super();
  }

  getType(): string {
    return "grounding-verification";
  }

  build(params: {
    query: string;
    answer: string;
    groundingContext: string;
  }): string {
    const template =
      this.registry.getTemplateString(this.getType()) || this.fallbackTemplate;

    return template
      .replace("{{query}}", params.query)
      .replace("{{answer}}", params.answer)
      .replace("{{groundingContext}}", params.groundingContext);
  }

  /**
   * Formats grounding context (logs) for verification.
   */
  static formatGroundingContext(contexts: any[]): string {
    if (!contexts || contexts.length === 0) {
      return "No grounding context provided.";
    }

    return contexts
      .map((ctx, i) => `[Log ${i + 1}]\n${JSON.stringify(ctx, null, 2)}`)
      .join("\n\n");
  }
}
