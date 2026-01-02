import { Module } from "@nestjs/common";
import { EmbeddingUseCase, SearchUseCase } from "@embeddings/in-ports";
import {
  EmbeddingPort,
  RerankPort,
  SynthesisPort,
  ChatHistoryPort,
  LogStoragePort,
} from "@embeddings/out-ports";
import { EmbeddingService, SearchService } from "@embeddings/service";
import {
  QueryPreprocessorService,
  SummaryEnrichmentService,
  AggregationService,
  SessionCacheService,
  QueryReformulationService,
  ContextCompressionService,
  SemanticCacheService,
} from "@embeddings/service/sub-services";
import {
  VoyageAdapter,
  VoyageClient,
  GeminiAdapter,
  GeminiClient,
  MongoLogStorageAdapter,
  MongoChatHistoryAdapter,
  MongoEmbeddingClient,
} from "@embeddings/infrastructure";
import {
  EmbeddingController,
  SearchController,
} from "@embeddings/presentation";
import {
  PromptTemplateRegistry,
  QueryMetadataSynthesisPrompt,
  SemanticSynthesisPrompt,
  QueryReformulationSynthesisPrompt,
  HistorySummarizationSynthesisPrompt,
  StatisticalAnalysisPrompt,
  GroundingVerificationPrompt,
} from "@embeddings/value-objects/prompts";

@Module({
  controllers: [EmbeddingController, SearchController],
  providers: [
    // Prompt Template Registry (loads templates from JSON files)
    PromptTemplateRegistry,
    // Prompt Template Instances (injected with registry)
    {
      provide: QueryMetadataSynthesisPrompt,
      useFactory: (registry: PromptTemplateRegistry) => {
        return new QueryMetadataSynthesisPrompt(registry);
      },
      inject: [PromptTemplateRegistry],
    },
    {
      provide: SemanticSynthesisPrompt,
      useFactory: (registry: PromptTemplateRegistry) => {
        return new SemanticSynthesisPrompt(registry);
      },
      inject: [PromptTemplateRegistry],
    },
    {
      provide: QueryReformulationSynthesisPrompt,
      useFactory: (registry: PromptTemplateRegistry) => {
        return new QueryReformulationSynthesisPrompt(registry);
      },
      inject: [PromptTemplateRegistry],
    },
    {
      provide: HistorySummarizationSynthesisPrompt,
      useFactory: (registry: PromptTemplateRegistry) => {
        return new HistorySummarizationSynthesisPrompt(registry);
      },
      inject: [PromptTemplateRegistry],
    },
    {
      provide: StatisticalAnalysisPrompt,
      useFactory: (registry: PromptTemplateRegistry) => {
        return new StatisticalAnalysisPrompt(registry);
      },
      inject: [PromptTemplateRegistry],
    },
    {
      provide: GroundingVerificationPrompt,
      useFactory: (registry: PromptTemplateRegistry) => {
        return new GroundingVerificationPrompt(registry);
      },
      inject: [PromptTemplateRegistry],
    },
    // Infrastructure Clients (Initialization only)
    VoyageClient,
    GeminiClient,
    MongoEmbeddingClient,
    // Query Preprocessing Service
    QueryPreprocessorService,
    // Summary Enrichment Service
    SummaryEnrichmentService,
    // Aggregation Service
    AggregationService,
    // Step 3: Conversational RAG Services
    SessionCacheService,
    QueryReformulationService,
    ContextCompressionService,
    // Step 5: Semantic Caching Service
    SemanticCacheService,
    // Services (Inbound Ports, Use Cases)
    {
      provide: EmbeddingUseCase,
      useClass: EmbeddingService,
    },
    {
      provide: SearchUseCase,
      useClass: SearchService,
    },
    // Infrastructures (Outbound Ports, Adapters)
    {
      provide: EmbeddingPort,
      useClass: VoyageAdapter,
    },
    {
      provide: RerankPort,
      useClass: VoyageAdapter,
    },
    {
      provide: SynthesisPort,
      useClass: GeminiAdapter,
    },
    {
      provide: ChatHistoryPort,
      useClass: MongoChatHistoryAdapter,
    },
    {
      provide: LogStoragePort,
      useClass: MongoLogStorageAdapter,
    },
  ],
})
export class EmbeddingsModule {}
