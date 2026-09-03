import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type Right = { code: number; name: string }

type Credentials = {
  token: string
  sessionId: string
  staffId: number
  staffName: string
  isAdmin: boolean
  rights: Right[]
}

type AuthState = {
  token: string | null
  sessionId: string | null
  staffId: number | null
  staffName: string
  isAdmin: boolean
  rights: Right[]
  setCredentials: (payload: Credentials) => void
  updateStaffName: (staffName: string) => void
  logout: () => void
  /**
   * Proactive RBAC check (mirror grey-out của MFC): admin luôn full quyền,
   * còn lại true nếu rights chứa code. Dùng để disabled/ẩn nút TRƯỚC khi gọi API.
   */
  hasRight: (code: number) => boolean
}

const AUTH_STORAGE_KEY = 'fnet-auth'

// Một lần chuyển credential cũ khỏi localStorage sang sessionStorage để người dùng
// đang mở WebUI không bị logout giữa lúc nâng cấp. Sau migration, browser restart
// sẽ xóa token thay vì giữ credential trên máy quầy dùng chung.
const legacyAuth = localStorage.getItem(AUTH_STORAGE_KEY)
if (!sessionStorage.getItem(AUTH_STORAGE_KEY) && legacyAuth) {
  sessionStorage.setItem(AUTH_STORAGE_KEY, legacyAuth)
}
localStorage.removeItem(AUTH_STORAGE_KEY)

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      sessionId: null,
      staffId: null,
      staffName: '',
      isAdmin: false,
      rights: [],
      setCredentials: ({ token, sessionId, staffId, staffName, isAdmin, rights }) => {
        set({ token, sessionId, staffId, staffName, isAdmin, rights })
      },
      updateStaffName: (staffName) => set({ staffName }),
      logout: () => {
        set({
          token: null,
          sessionId: null,
          staffId: null,
          staffName: '',
          isAdmin: false,
          rights: [],
        })
      },
      hasRight: (code) => {
        const state = get()
        return state.isAdmin || state.rights.some((r) => r.code === code)
      },
    }),
    {
      name: AUTH_STORAGE_KEY,
      storage: createJSONStorage(() => sessionStorage),
    },
  ),
)
