export const themeIds = ['classic', 'light', 'dark', 'warm'] as const

export type ThemeId = (typeof themeIds)[number]

export type ThemeDefinition = {
  id: ThemeId
  label: string
  colorScheme: 'light' | 'dark'
}

export const themes: readonly ThemeDefinition[] = [
  { id: 'classic', label: 'Classic', colorScheme: 'light' },
  { id: 'light', label: 'Sáng', colorScheme: 'light' },
  { id: 'dark', label: 'Tối', colorScheme: 'dark' },
  { id: 'warm', label: 'Ấm', colorScheme: 'light' },
]

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && themeIds.includes(value as ThemeId)
}

export function normalizeTheme(value: unknown): ThemeId {
  if (isThemeId(value)) return value
  if (value === 'swarm') return 'warm'
  return 'classic'
}
