import { WideEvent } from '@logging/domain';

export abstract class SummaryEnrichmentUseCase {
  abstract generateDualLayerSummary(event: WideEvent): string;
}
