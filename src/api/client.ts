import { useAuthStore } from '../store/auth'
import { pushToast } from '../store/toast'
import { useDebugStore } from '../store/debugStore'

// Dev: đi qua Vite proxy (/api -> 127.0.0.1:18099) để tránh CORS (backend chưa gắn
// Access-Control-Allow-Origin ở phần lớn route).
// Prod: đọc VITE_API_BASE_URL (IP LAN của server, chốt user 2026-07-16) — KHÔNG
// hardcode loopback của chính tablet. Fallback về loopback chỉ để không vỡ build khi
// quên set env (dev-only); prod thật BẮT BUỘC set .env.production / .env.local.
export const API_BASE_URL: string = import.meta.env.DEV
  ? '/api'
  : ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://127.0.0.1:18099')

export type ApiEnvelope<T> = {
  status: string
  message: string
  data: T | ''
  error: string
}

export class ApiError<TDetails = unknown> extends Error {
  readonly httpStatus: number
  readonly code?: string
  readonly details?: TDetails

  constructor(
    message: string,
    options: { httpStatus?: number; code?: string; details?: TDetails } = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.httpStatus = options.httpStatus ?? 200
    this.code = options.code
    this.details = options.details
  }
}

function authHeaders(): HeadersInit {
  const token = useAuthStore.getState().token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/** Lỗi 403 RBAC_DENIED — KHÔNG logout, mang thông tin quyền để tầng trên xử lý nếu cần. */
export class RbacDeniedError extends Error {
  requiredRight?: number
  requiredRightName?: string
  constructor(message: string, requiredRight?: number, requiredRightName?: string) {
    super(message)
    this.name = 'RbacDeniedError'
    this.requiredRight = requiredRight
    this.requiredRightName = requiredRightName
  }
}

async function parseEnvelope<T>(response: Response): Promise<T> {
  let rawBody: unknown
  try {
    rawBody = await response.json()
  } catch {
    rawBody = undefined
  }

  // 401: token hết hạn/không hợp lệ → logout + về login (hành vi cũ).
  if (response.status === 401) {
    useAuthStore.getState().logout()
    const body = rawBody as { message?: string; code?: string } | undefined
    throw new ApiError(body?.message || 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại', {
      httpStatus: 401,
      code: body?.code,
      details: rawBody,
    })
  }

  // 403: thiếu quyền. Nếu body là RBAC_DENIED → toast message backend (KHÔNG logout).
  if (response.status === 403) {
    const body = (rawBody ?? {}) as Partial<{
      code: string
      message: string
      requiredRight: number
      requiredRightName: string
      data: { code?: string }
    }>
    const code = body.code ?? body.data?.code
    if (body.code === 'RBAC_DENIED') {
      const message = body.message || 'Bạn không có quyền thực hiện thao tác này.'
      // Đọc thẳng message backend (khớp tên quyền MFC) — không tự chế câu chữ.
      pushToast(message, 'error')
      useDebugStore.getState().addLog({
        type: 'API_ERROR',
        message: `403 RBAC_DENIED`,
        url: response.url,
        details: body
      })
      throw new RbacDeniedError(message, body.requiredRight, body.requiredRightName)
    }
    useDebugStore.getState().addLog({
      type: 'API_ERROR',
      message: `403 Forbidden`,
      url: response.url,
      details: body
    })
    throw new ApiError(body.message || 'Bạn không có quyền truy cập (403)', {
      httpStatus: 403,
      code,
      details: rawBody,
    })
  }

  if (!response.ok) {
    const body = rawBody as { message?: string; code?: string; data?: { code?: string } } | undefined
    const errorMsg = body?.message || `HTTP ${response.status} ${response.statusText}`
    useDebugStore.getState().addLog({
      type: 'API_ERROR',
      message: errorMsg,
      url: response.url,
    })
    throw new ApiError(errorMsg, {
      httpStatus: response.status,
      code: body?.code ?? body?.data?.code,
      details: rawBody,
    })
  }

  if (!rawBody || typeof rawBody !== 'object') {
    useDebugStore.getState().addLog({
      type: 'API_ERROR',
      message: 'Invalid JSON response',
      url: response.url,
    })
    throw new ApiError('Máy chủ trả dữ liệu không hợp lệ', {
      httpStatus: response.status,
      details: rawBody,
    })
  }

  const payload = rawBody as ApiEnvelope<T>

  if (payload.status !== '1') {
    const details = payload.data === '' ? undefined : payload.data
    const code =
      details && typeof details === 'object' && 'code' in details
        ? String((details as { code: unknown }).code)
        : undefined
    useDebugStore.getState().addLog({
      type: 'API_ERROR',
      message: payload.message || 'Request failed (status != 1)',
      url: response.url,
      details: payload
    })
    throw new ApiError(payload.message || 'Request failed', {
      httpStatus: response.status,
      code,
      details,
    })
  }

  return payload.data === '' ? (undefined as T) : payload.data
}

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { ...authHeaders() },
  })
  return parseEnvelope<T>(response)
}

export async function apiPost<TResponse, TBody>(path: string, body: TBody): Promise<TResponse> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify(body),
  })

  return parseEnvelope<TResponse>(response)
}

export async function apiGetBlob(path: string): Promise<Blob> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { ...authHeaders() },
  })
  if (response.status === 401) {
    useAuthStore.getState().logout()
    throw new Error('Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại')
  }
  if (!response.ok) {
    throw new Error(`Không tải được dữ liệu (${response.status})`)
  }
  return response.blob()
}

export async function apiPostForm<TResponse>(
  path: string,
  body: Record<string, string | number | boolean | null | undefined>,
): Promise<TResponse> {
  const form = new URLSearchParams()
  Object.entries(body).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      form.set(key, String(value))
    }
  })

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      ...authHeaders(),
    },
    body: form,
  })

  return parseEnvelope<TResponse>(response)
}

export async function apiPut<TResponse, TBody>(path: string, body: TBody): Promise<TResponse> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify(body),
  })

  return parseEnvelope<TResponse>(response)
}

export async function apiDelete<TResponse, TBody = unknown>(path: string, body?: TBody): Promise<TResponse> {
  const options: RequestInit = {
    method: 'DELETE',
    headers: { ...authHeaders() },
  }
  if (body !== undefined) {
    options.headers = { ...options.headers, 'Content-Type': 'application/json' };
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`${API_BASE_URL}${path}`, options)
  return parseEnvelope<TResponse>(response)
}
