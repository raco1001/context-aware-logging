import { apiFetch } from '@/shared/api/httpClient'
import type { AnalysisResult } from '@/shared/lib/loglens'

const SEARCH_ASK_PATH = '/search/ask'
const SEARCH_HISTORY_PATH = '/search/history'

export async function searchLogs(query: string, sessionId: string | null) {
  const url = `${SEARCH_ASK_PATH}?q=${encodeURIComponent(query)}&sessionId=${
    sessionId ?? ''
  }`

  const res = await apiFetch(url)

  const data = (await res.json()) as
    | AnalysisResult
    | { error: string; message?: string }

  return { res, data }
}

export async function getSessionHistory(sessionId: string) {
  const url = `${SEARCH_HISTORY_PATH}?sessionId=${encodeURIComponent(
    sessionId,
  )}`

  const res = await apiFetch(url)

  const data = (await res.json()) as
    | AnalysisResult[]
    | {
        error: string
        message?: string
      }

  return { res, data }
}

