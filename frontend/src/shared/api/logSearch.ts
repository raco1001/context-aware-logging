import { apiFetch } from '@/shared/api/httpClient'
import type { AnalysisResult, SessionSummary } from '@/shared/lib/loglens'

const SEARCH_ASK_PATH = '/search/ask'
const SEARCH_HISTORY_PATH = '/search/history'
const SEARCH_SESSIONS_PATH = '/search/sessions'

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

export async function getSessionList() {
  const res = await apiFetch(SEARCH_SESSIONS_PATH)

  const data = (await res.json()) as
    | SessionSummary[]
    | { error: string; message?: string }

  return { res, data }
}

export async function deleteSession(sessionId: string) {
  const path = `${SEARCH_SESSIONS_PATH}/${encodeURIComponent(sessionId)}`
  const res = await apiFetch(path, { method: 'DELETE' })

  const data = (await res.json()) as
    | { deleted: boolean }
    | { error: string; message?: string }

  return { res, data }
}

