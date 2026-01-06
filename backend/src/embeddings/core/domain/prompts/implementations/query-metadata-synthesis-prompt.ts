import { PromptTemplate } from "../prompt-template.vo";
import { PromptTemplateRegistry } from "../prompt-template-registry";
import { QUERY_METADATA_SYNTHESIS_FALLBACK } from "src/embeddings/core/value-objects/fallbacks/prompts";
/**
 * QueryMetadataSynthesisPrompt - Query metadata extraction prompt template
 *
 * A prompt template for extracting metadata (time range, service, error code, etc.) from a natural language query.
 */
export class QueryMetadataSynthesisPrompt extends PromptTemplate {
  private readonly fallbackTemplate = QUERY_METADATA_SYNTHESIS_FALLBACK;

  constructor(private readonly registry: PromptTemplateRegistry) {
    super();
  }

  getType(): string {
    return "query-metadata-extraction";
  }

  build(params: { query: string; currentTime?: Date }): string {
    const template =
      this.registry.getTemplateString(this.getType()) || this.fallbackTemplate;

    const currentTime = params.currentTime || new Date();
    return template
      .replace("{{currentTime}}", currentTime.toISOString())
      .replace("{{query}}", params.query);
  }
}
