import {
  Controller,
  Get,
  Delete,
  Query,
  Param,
  Logger,
  Headers,
} from '@nestjs/common';
import { SearchUseCase } from '@embeddings/in-ports';
import { Service } from '@logging/presentation';

/**
 * SearchController - Controller for search operations.
 * Handles RAG queries and chat history retrieval.
 */
@Controller('search')
@Service('embeddings')
export class SearchController {
  private readonly logger = new Logger(SearchController.name);

  constructor(private readonly searchUseCase: SearchUseCase) {}

  @Get('ask')
  async ask(
    @Query('q') query: string,
    @Query('sessionId') sessionId?: string,
    @Headers('x-client-id') clientId?: string,
  ) {
    if (!query) {
      return { error: '(q) query is required.' };
    }

    this.logger.log(
      `Received RAG query: ${query} (Session: ${sessionId || 'none'})`,
    );
    try {
      return await this.searchUseCase.ask(query, sessionId, clientId);
    } catch (error) {
      this.logger.error(`Failed to process search query: ${error.message}`);
      return {
        error: 'Error occurred while searching and analyzing.',
        message: error.message,
      };
    }
  }

  @Get('history')
  async getHistory(
    @Query('sessionId') sessionId: string,
    @Headers('x-client-id') _clientId?: string,
  ) {
    if (!sessionId) {
      return { error: 'sessionId is required.' };
    }
    return await this.searchUseCase.getChatHistory(sessionId);
  }

  @Get('sessions')
  async listSessions(@Headers('x-client-id') clientId?: string) {
    return await this.searchUseCase.listSessions(clientId ?? '');
  }

  @Delete('sessions/:sessionId')
  async deleteSession(
    @Param('sessionId') sessionId: string,
    @Headers('x-client-id') clientId?: string,
  ) {
    const deleted = await this.searchUseCase.deleteSession(
      sessionId ?? '',
      clientId ?? '',
    );
    return { deleted };
  }
}
