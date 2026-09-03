import { normalizeTheme, type ThemeId } from '../design-system/theme/themeRegistry'

const PREFERENCE_VERSION = 1
const BROWSER_KEY = `fnet-web:preferences:v${PREFERENCE_VERSION}:browser`
const LEGACY_THEME_KEY = 'fnet_theme'
const LEGACY_COLUMNS_KEY = 'fnet_workstation_columns'

export type BrowserPreferences = {
  version: number
  theme: ThemeId
  workstationColumns?: string[]
  customerColumns?: string[]
}

const defaults: BrowserPreferences = {
  version: PREFERENCE_VERSION,
  theme: 'classic',
}

function readJson(key: string): unknown {
  try {
    const value = localStorage.getItem(key)
    return value ? JSON.parse(value) : null
  } catch {
    return null
  }
}

function migrateLegacyPreferences(): BrowserPreferences {
  const legacyTheme = localStorage.getItem(LEGACY_THEME_KEY)
  const legacyColumns = readJson(LEGACY_COLUMNS_KEY)

  const migrated: BrowserPreferences = {
    ...defaults,
    theme: normalizeTheme(legacyTheme),
    workstationColumns: Array.isArray(legacyColumns)
      ? legacyColumns.filter((item): item is string => typeof item === 'string')
      : undefined,
  }

  localStorage.setItem(BROWSER_KEY, JSON.stringify(migrated))
  localStorage.removeItem(LEGACY_THEME_KEY)
  localStorage.removeItem(LEGACY_COLUMNS_KEY)
  return migrated
}

export function getBrowserPreferences(): BrowserPreferences {
  const stored = readJson(BROWSER_KEY)
  if (!stored || typeof stored !== 'object') return migrateLegacyPreferences()

  const record = stored as Partial<BrowserPreferences>
  return {
    ...defaults,
    ...record,
    version: PREFERENCE_VERSION,
    theme: normalizeTheme(record.theme),
    workstationColumns: Array.isArray(record.workstationColumns)
      ? record.workstationColumns.filter((item): item is string => typeof item === 'string')
      : undefined,
    customerColumns: Array.isArray(record.customerColumns)
      ? record.customerColumns.filter((item): item is string => typeof item === 'string')
      : undefined,
  }
}

export function updateBrowserPreferences(
  patch: Partial<Omit<BrowserPreferences, 'version'>>,
): BrowserPreferences {
  const next = { ...getBrowserPreferences(), ...patch, version: PREFERENCE_VERSION }
  localStorage.setItem(BROWSER_KEY, JSON.stringify(next))
  return next
}

export function resetBrowserPreferences(): BrowserPreferences {
  localStorage.removeItem(BROWSER_KEY)
  return migrateLegacyPreferences()
}
