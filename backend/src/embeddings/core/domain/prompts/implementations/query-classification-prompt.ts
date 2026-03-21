import { PromptTemplate } from '../prompt-template';
import { PromptTemplateRegistry } from '../prompt-template-registry';
import { QueryMetadata } from '@embeddings/dtos';

const QUERY_CLASSIFICATION_FALLBACK = `
You are a log analysis expert. Classify the query and extract metadata in one pass.

Return ONLY valid JSON with this schema:
{
  "templateId": "TOP_ERROR_CODES|ERROR_DISTRIBUTION_BY_ROUTE|ERROR_BY_SERVICE|ERROR_RATE|LATENCY_PERCENTILE|null",
  "params": {
    "topN": 10,
    "metadata": {
      "startTime": "ISO string or null",
      "endTime": "ISO string or null",
      "service": "payments|users|orders|products|null",
      "route": "/payments|/users|/orders|/products|null",
      "errorCode": "UPPERCASE_CODE or null",
      "hasError": true
    }
  }
}

templateId is null for SEMANTIC queries (specific incidents, root cause, individual log details).
templateId is non-null for STATISTICAL queries (counts, rates, aggregations, trends).

Current Time: {{currentTime}}
Initial Metadata: {{initialMetadata}}
Query: {{query}}
`;

export class QueryClassificationPrompt extends PromptTemplate {
  constructor(private readonly registry: PromptTemplateRegistry) {
    super();
  }

  getType(): string {
    return 'query-classification';
  }

  build(params: {
    query: string;
    currentTime?: Date;
    initialMetadata?: Partial<QueryMetadata>;
  }): string {
    const template =
      this.registry.getTemplateString(this.getType()) || QUERY_CLASSIFICATION_FALLBACK;

    const currentTime = params.currentTime || new Date();

    const metadataJson = params.initialMetadata
      ? JSON.stringify(
          {
            startTime: params.initialMetadata.startTime
              ? (params.initialMetadata.startTime as Date).toISOString?.() ??
                params.initialMetadata.startTime
              : null,
            endTime: params.initialMetadata.endTime
              ? (params.initialMetadata.endTime as Date).toISOString?.() ??
                params.initialMetadata.endTime
              : null,
            service: params.initialMetadata.service || null,
            route: params.initialMetadata.route || null,
            errorCode: params.initialMetadata.errorCode || null,
            hasError: params.initialMetadata.hasError || false,
          },
          null,
          2,
        )
      : 'null';

    return template
      .replace('{{currentTime}}', currentTime.toISOString())
      .replace('{{initialMetadata}}', metadataJson)
      .replace('{{query}}', params.query);
  }
}
