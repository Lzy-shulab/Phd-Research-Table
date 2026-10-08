export interface SavedDraft<T> {
  value: T
  savedAt: string
}

export function readDraft<T>(key: string): SavedDraft<T> | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(`workbench.draft.${key}`) ?? 'null') as SavedDraft<T> | null
    return parsed && parsed.value && typeof parsed.savedAt === 'string' ? parsed : null
  } catch {
    return null
  }
}

export function writeDraft<T>(key: string, value: T) {
  localStorage.setItem(`workbench.draft.${key}`, JSON.stringify({ value, savedAt: new Date().toISOString() }))
}

export function clearDraft(key: string) {
  localStorage.removeItem(`workbench.draft.${key}`)
}
