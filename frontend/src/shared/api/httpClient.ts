import { getClientId } from '@/shared/api/clientId'

const RAW_BACKEND_URL =
  (import.meta.env.VITE_BACKEND_URL as string | undefined) ??
  'http://localhost:3000'

const BASE_URL = RAW_BACKEND_URL.replace(/\/+$/, '')

function buildUrl(path: string): string {
  if (!path) {
    return BASE_URL
  }

  return `${BASE_URL}/${path.replace(/^\/+/, '')}`
}

export async function apiFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const url = buildUrl(path)
  const headers = new Headers(init?.headers)
  headers.set('X-Client-Id', getClientId())
  return fetch(url, { ...init, headers })
}

