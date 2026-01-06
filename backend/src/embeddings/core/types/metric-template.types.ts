export interface IMetricTemplate {
  id: string;
  name: string;
  description: string;
  pipelineTemplate: (params: Record<string, any>) => any[];
  requiredParams: string[];
}
