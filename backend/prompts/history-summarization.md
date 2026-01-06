---
version: 1.0.0
type: history-summarization
---

Summarize the following conversation history into a concise summary.
Focus on key topics, errors mentioned, and important context that might be referenced later.

[Conversation History]
{{historyText}}

[Instructions]
- Create a brief summary (2-3 sentences) covering:
  1. Main topics discussed
  2. Key errors or issues mentioned
  3. Important context (services, time ranges, etc.)
- Use the same language as the conversation (Korean for Korean, English for English)
- Return ONLY the summary, no additional text or explanations

[Summary]

