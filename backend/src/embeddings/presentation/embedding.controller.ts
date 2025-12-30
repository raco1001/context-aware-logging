import {
  Controller,
  Post,
  Get,
  Query,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { EmbeddingUseCase } from "@embeddings/in-ports/index";
import { ConfigService } from "@nestjs/config";
import { Service } from "@logging/presentation/service.decorator";

@Controller("embeddings")
@Service("embeddings")
export class EmbeddingController {
  constructor(
    private readonly embeddingUseCase: EmbeddingUseCase,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Trigger batch embedding for pending logs.
   * Example: POST /embeddings/batch?limit=100
   */
  @Post("batch")
  @HttpCode(HttpStatus.OK)
  async processBatch(
    @Query("limit", new ParseIntPipe({ optional: true }))
    limit: number = parseInt(
      this.configService.get<string>("EMBEDDING_BATCH_CHUNK_SIZE") || "50",
      10,
    ),
  ) {
    const processedCount =
      await this.embeddingUseCase.processPendingLogs(limit);

    return {
      message: "Batch embedding process completed",
      processedCount,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Perform semantic search on embedded logs.
   * Example: GET /embeddings/search?q=payment error&limit=5
   */
  @Get("search")
  async search(
    @Query("q") query: string,
    @Query("limit", new ParseIntPipe({ optional: true })) limit: number = 5,
  ) {
    const results = await this.embeddingUseCase.search(query, limit);
    return {
      query,
      results,
      timestamp: new Date().toISOString(),
    };
  }
}
