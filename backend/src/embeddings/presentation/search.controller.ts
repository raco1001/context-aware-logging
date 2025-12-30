import { Controller, Get, Query, Logger } from '@nestjs/common';
import { SearchUseCase } from '@embeddings/in-ports/index';
import { Service } from '@logging/presentation/service.decorator';

@Controller('search')
@Service('embeddings')
export class SearchController {
  private readonly logger = new Logger(SearchController.name);

  constructor(private readonly searchUseCase: SearchUseCase) {}

  @Get('ask')
  async ask(@Query('q') query: string, @Query('sessionId') sessionId?: string) {
    if (!query) {
      return { error: '질문(q)을 입력해주세요.' };
    }

    this.logger.log(
      `Received RAG query: ${query} (Session: ${sessionId || 'none'})`,
    );
    try {
      return await this.searchUseCase.ask(query, sessionId);
    } catch (error) {
      this.logger.error(`Failed to process search query: ${error.message}`);
      return {
        error: '검색 및 분석 중 오류가 발생했습니다.',
        message: error.message,
      };
    }
  }

  @Get('history')
  async getHistory(@Query('sessionId') sessionId: string) {
    if (!sessionId) {
      return { error: 'sessionId를 입력해주세요.' };
    }
    return await this.searchUseCase.getChatHistory(sessionId);
  }
}
