import { apiGet } from './client'

export type ServerInfo = {
  ver: string
  rd: string
  /** License đã mã hoá (dùng cho check third-party) — không tự giải mã/hiển thị ở FE. */
  meta: string
}

// GET /system/version (FNetHttp/SystemHandlers.cpp: ServerVersionRequestHandler) — LoopbackOnly
// (mặc định: loopback HOẶC Bearer token hợp lệ từ LAN), trả đúng khuôn {status,message,data}.
// Trả đầy đủ field như /fninf (ver, rd, meta) để tái dùng cho các màn hình sau này.
export function getServerInfo() {
  return apiGet<ServerInfo>('/system/version')
}
