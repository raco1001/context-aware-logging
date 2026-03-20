import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EmbeddingUseCase,
  SearchUseCase,
  INTENT_CLASSIFIER,
  QUERY_STRATEGIES,
} from '@embeddings/in-ports';
import {
  EmbeddingPort,
  RerankPort,
  SynthesisPort,
  ChatHistoryPort,
  LogStoragePort,
  SessionCachePort,
} from '@embeddings/out-ports';
import {
  EmbeddingService,
  SearchService,
  SemanticQueryStrategy,
  StatisticalQueryStrategy,
  ConversationalQueryStrategy,
  KeywordIntentClassifier,
  HybridIntentClassifier,
  QueryPreprocessorService,
  SummaryEnrichmentService,
  AggregationService,
  QueryReformulationService,
  ContextCompressionService,
} from '@embeddings/service';
import {
  VoyageAdapter,
  VoyageClient,
  GeminiAdapter,
  GeminiClient,
  MongoLogStorageAdapter,
  MongoChatHistoryAdapter,
  MongoEmbeddingClient,
  SessionInMemoryAdapter,
  RedisClient,
  SessionRedisAdapter,
  SessionCacheService,
  SemanticCacheService,
} from '@embeddings/infrastructure';
import {
  EmbeddingController,
  SearchController,
} from '@embeddings/presentation';
import {
  PromptTemplateRegistry,
  QueryMetadataSynthesisPrompt,
  SemanticSynthesisPrompt,
  QueryReformulationSynthesisPrompt,
  HistorySummarizationSynthesisPrompt,
  StatisticalAnalysisPrompt,
  GroundingVerificationPrompt,
  LogStyleTransformationPrompt,
} from '@embeddings/domain/prompts';

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
    {
      provide: LogStyleTransformationPrompt,
      useFactory: (registry: PromptTemplateRegistry) => {
        return new LogStyleTransformationPrompt(registry);
      },
      inject: [PromptTemplateRegistry],
    },
    // Infrastructure Clients (Initialization only)
    VoyageClient,
    GeminiClient,
    MongoEmbeddingClient,
    RedisClient,
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
    // Query Strategies (Strategy Pattern)
    SemanticQueryStrategy,
    StatisticalQueryStrategy,
    ConversationalQueryStrategy,
    KeywordIntentClassifier,
    HybridIntentClassifier,
    {
      provide: INTENT_CLASSIFIER,
      useClass: HybridIntentClassifier,
    },
    {
      provide: QUERY_STRATEGIES,
      useFactory: (
        semantic: SemanticQueryStrategy,
        statistical: StatisticalQueryStrategy,
        conversational: ConversationalQueryStrategy,
      ) => [semantic, statistical, conversational],
      inject: [
        SemanticQueryStrategy,
        StatisticalQueryStrategy,
        ConversationalQueryStrategy,
      ],
    },
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
    // Session Cache: Redis (distributed) or InMemory (single instance)
    // Set SESSION_CACHE_TYPE=redis or memory in .env to use Redis
    {
      provide: SessionCachePort,
      useFactory: (configService: ConfigService, redisClient: RedisClient) => {
        const cacheType =
          configService.get<string>('SESSION_CACHE_TYPE') || 'memory';
        if (cacheType === 'redis') {
          return new SessionRedisAdapter(redisClient);
        }
        return new SessionInMemoryAdapter();
      },
      inject: [ConfigService, RedisClient],
    },
  ],
})
export class EmbeddingsModule {}
