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
  VoyageAdapter,
  VoyageClient,
  GeminiAdapter,
  GeminiClient,
  MongoLogAdapter,
  MongoSearchAdapter,
  MongoEmbeddingConnection,
} from "@embeddings/infrastructure";
import {
  EmbeddingController,
  SearchController,
} from "@embeddings/presentation";

@Module({
  controllers: [EmbeddingController, SearchController],
  providers: [
    // Infrastructure Clients (Initialization only)
    VoyageClient,
    GeminiClient,
    MongoEmbeddingConnection,
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
      useClass: MongoSearchAdapter,
    },
    {
      provide: LogStoragePort,
      useClass: MongoLogAdapter,
    },
  ],
})
export class EmbeddingsModule {}
