import { createContext, useContext } from 'react'
import { themes, type ThemeId } from './themeRegistry'

export type ThemeContextValue = {
  theme: ThemeId
  setTheme: (theme: ThemeId) => void
  themes: typeof themes
}

export const ThemeContext = createContext<ThemeContextValue | null>(null)

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used within ThemeProvider')
  return context
}
