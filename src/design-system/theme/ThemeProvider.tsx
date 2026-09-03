import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  getBrowserPreferences,
  updateBrowserPreferences,
} from '../../preferences/preferenceStore'
import { ThemeContext, type ThemeContextValue } from './themeContext'
import { normalizeTheme, themes, type ThemeId } from './themeRegistry'

function applyTheme(theme: ThemeId) {
  document.documentElement.dataset.theme = theme
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(() => {
    const initialTheme = normalizeTheme(getBrowserPreferences().theme)
    applyTheme(initialTheme)
    return initialTheme
  })

  useEffect(() => {
    applyTheme(theme)
    updateBrowserPreferences({ theme })
  }, [theme])

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme: setThemeState,
      themes,
    }),
    [theme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
