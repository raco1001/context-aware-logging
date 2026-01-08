import { PromptTemplate } from "../prompt-template";
import { PromptTemplateRegistry } from "../prompt-template-registry";
import { LOG_STYLE_TRANSFORMATION_FALLBACK } from "src/embeddings/core/value-objects/fallbacks/prompts";

/**
 * LogStyleTransformationPrompt - Prompt template for transforming queries to log-style narratives
 */
export class LogStyleTransformationPrompt extends PromptTemplate {
  private readonly fallbackTemplate = LOG_STYLE_TRANSFORMATION_FALLBACK;

  constructor(private readonly registry: PromptTemplateRegistry) {
    super();
  }

  getType(): string {
    return "log-style-transformation";
  }

  build(params: { query: string }): string {
    const template =
      this.registry.getTemplateString(this.getType()) || this.fallbackTemplate;

    return template.replace("{{query}}", params.query);
  }
}
