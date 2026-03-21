import type { ChatMessage } from './types'

export const INITIAL_MESSAGES: ChatMessage[] = [
  {
    id: 'welcome',
    role: 'assistant',
    content:
      'Welcome to LogLens. I can help you analyze your log data using natural language. Try asking me questions like:\n\n- "What caused the recent payment failures?"\n- "Show me error trends in the last 24 hours"\n- "How many 5xx errors happened on /payments?"\n\nI maintain conversation context, so feel free to ask follow-up questions.',
    timestamp: new Date(),
  },
]
