import { Controller, Get, Query, Logger } from "@nestjs/common";
import { SearchUseCase } from "@embeddings/in-ports";
import { Service } from "@logging/presentation";

/**
 * SearchController - Controller for search operations.
 * Handles RAG queries and chat history retrieval.
 */
@Controller("search")
@Service("embeddings")
export class SearchController {
  private readonly logger = new Logger(SearchController.name);

  constructor(private readonly searchUseCase: SearchUseCase) {}

  @Get("ask")
  async ask(@Query("q") query: string, @Query("sessionId") sessionId?: string) {
    if (!query) {
      return { error: "(q) query is required." };
    }

    this.logger.log(
      `Received RAG query: ${query} (Session: ${sessionId || "none"})`,
    );
    try {
      return await this.searchUseCase.ask(query, sessionId);
    } catch (error) {
      this.logger.error(`Failed to process search query: ${error.message}`);
      return {
        error: "Error occurred while searching and analyzing.",
        message: error.message,
      };
    }
  }

  @Get("history")
  async getHistory(@Query("sessionId") sessionId: string) {
    if (!sessionId) {
      return { error: "sessionId is required." };
    }
    return await this.searchUseCase.getChatHistory(sessionId);
  }
}
