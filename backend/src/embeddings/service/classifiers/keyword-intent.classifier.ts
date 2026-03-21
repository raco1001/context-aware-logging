import { Injectable } from '@nestjs/common';
import { CONVERSATIONAL_KEYWORDS } from '@embeddings/value-objects/filter';

/**
 * KeywordIntentClassifier - Provides a fast-path check for conversational queries.
 *
 * Conversational queries (session summary, history references, meta-conversation)
 * are detected before any LLM call, skipping reformulation and metadata extraction.
 * All other intent routing is handled by classifyAndExtract() in GeminiAdapter.
 */
@Injectable()
export class KeywordIntentClassifier {
  isConversationalKeywordMatch(query: string): boolean {
    const lowerQuery = query.toLowerCase();
    return CONVERSATIONAL_KEYWORDS.some((k) => lowerQuery.includes(k));
  }
}
