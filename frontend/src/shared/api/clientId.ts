const STORAGE_KEY = 'loglens-client-id'

export function getClientId(): string {
  const existing = localStorage.getItem(STORAGE_KEY)
  if (existing) {
    return existing
  }
  const id = crypto.randomUUID()
  localStorage.setItem(STORAGE_KEY, id)
  return id
}
