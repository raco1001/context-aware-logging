/**
 * PromptInstance - Entity for tracking prompt usage
 *
 * In Phase 5, this entity is used to track prompt usage, A/B tests, and monitoring.
 *
 * Currently, only the basic structure is defined, and it will be used in Phase 5.
 */
export class PromptInstance {
  constructor(
    public readonly id: string, // UUID
    public readonly templateType: string, // PromptTemplate.getType()
    public readonly promptText: string, // Completed prompt
    public readonly parameters: Record<string, any>, // Used parameters
    public readonly timestamp: Date,
    public readonly metadata?: {
      model?: string; // e.g., gemini-2.5-flash
      sessionId?: string;
      requestId?: string;
      cost?: number;
      tokens?: number;
      responseTime?: number;
    },
  ) {}

  /**
   * Factory method to create a PromptInstance
   *
   * @param templateType Prompt template type
   * @param promptText Completed prompt text
   * @param parameters Used parameters
   * @param metadata Additional metadata
   */
  static create(
    templateType: string,
    promptText: string,
    parameters: Record<string, any>,
    metadata?: PromptInstance["metadata"],
  ): PromptInstance {
    return new PromptInstance(
      crypto.randomUUID(),
      templateType,
      promptText,
      parameters,
      new Date(),
      metadata,
    );
  }
}
