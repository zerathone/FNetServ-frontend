import { useCallback, useRef } from 'react'

type IntentState = {
  fingerprint: string
  key: string
}

function randomId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function createIdempotencyKey(scope: string) {
  const safeScope = scope.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 20) || 'intent'
  return `${safeScope}-${randomId()}`.slice(0, 64)
}

export function fingerprintIntent(value: unknown) {
  return JSON.stringify(value)
}

export class IdempotencyIntent {
  private state: IntentState | null = null
  private readonly scope: string

  constructor(scope: string) {
    this.scope = scope
  }

  getKey(fingerprint: string) {
    if (this.state?.fingerprint === fingerprint) return this.state.key

    const key = createIdempotencyKey(this.scope)
    this.state = { fingerprint, key }
    return key
  }

  clear() {
    this.state = null
  }
}

/**
 * Giữ nguyên idem cho cùng một ý định qua timeout/retry.
 * Fingerprint đổi => nội dung giao dịch đổi => sinh key mới.
 * Gọi clearKey khi thành công hoặc khi người dùng hủy ý định.
 */
export function useIdempotentIntent(scope: string) {
  const intentRef = useRef<IdempotencyIntent | null>(null)
  if (!intentRef.current) intentRef.current = new IdempotencyIntent(scope)

  const getKey = useCallback(
    (fingerprint: string) => intentRef.current!.getKey(fingerprint),
    [],
  )

  const clearKey = useCallback(() => {
    intentRef.current?.clear()
  }, [])

  return { getKey, clearKey }
}
