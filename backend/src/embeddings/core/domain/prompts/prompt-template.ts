/**
 * PromptTemplate - Value Object Base Class
 *
 * The abstract class that defines the immutable prompt template.
 * Each concrete prompt template class inherits from this class and implements it.
 *
 * Phase 4: Separates prompt logic from Infrastructure as Value Objects
 * Phase 5: Integrates with PromptInstance Entity to track prompt usage
 */
export abstract class PromptTemplate {
  /**
   * Unique identifier for the template (type-based)
   * Each concrete class must return a unique type.
   */
  abstract getType(): string;

  /**
   * Builds a completed prompt from the template parameters
   *
   * @param params Parameters needed for the prompt
   * @returns Completed prompt string
   */
  abstract build(params: Record<string, any>): string;

  /**
   * Version of the prompt template (optional)
   * Can be used for version management in Phase 5.
   */
  getVersion(): string {
    return '1.0.0';
  }
}
