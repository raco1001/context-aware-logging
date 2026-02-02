import { PromptTemplate } from '../prompt-template';
import { PromptTemplateRegistry } from '../prompt-template-registry';
import { QueryMetadata } from '@embeddings/dtos';

export class StatisticalAnalysisPrompt extends PromptTemplate {
  constructor(private readonly registry: PromptTemplateRegistry) {
    super();
  }

  getType(): string {
    return 'statistical-analysis';
  }

  build(params: {
    query: string;
    currentTime?: Date;
    initialMetadata?: QueryMetadata;
  }): string {
    const template = this.registry.getTemplateString(this.getType()) || '';
    const currentTime = params.currentTime || new Date();

    let result = template
      .replace('{{currentTime}}', currentTime.toISOString())
      .replace('{{query}}', params.query);

    if (params.initialMetadata) {
      const metadataJson = JSON.stringify(
        {
          startTime: params.initialMetadata.startTime?.toISOString() || null,
          endTime: params.initialMetadata.endTime?.toISOString() || null,
          service: params.initialMetadata.service || null,
          route: params.initialMetadata.route || null,
          errorCode: params.initialMetadata.errorCode || null,
          hasError: params.initialMetadata.hasError || false,
        },
        null,
        2,
      );
      result = result.replace('{{initialMetadata}}', metadataJson);
    } else {
      result = result.replace('{{initialMetadata}}', 'null');
    }

    return result;
  }
}
