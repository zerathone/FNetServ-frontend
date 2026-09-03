import type { Combo } from '../../api/combo'

export type ComboUsagePresentation = {
  label: string
  usableNow: boolean
  nextTransitionAtMs: number | null
}

function countdownLabel(targetMs: number, nowMs: number) {
  const minutes = Math.max(1, Math.ceil((targetMs - nowMs) / 60_000))
  if (minutes < 60) return `${minutes} phút nữa`
  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  if (hours < 24) return restMinutes ? `${hours}g ${restMinutes}p nữa` : `${hours} giờ nữa`
  const days = Math.floor(hours / 24)
  return `${days} ngày nữa`
}

export function comboUsagePresentation(
  combo: Combo,
  machineGroupId: number | null,
  serverNowMs: number,
): ComboUsagePresentation | null {
  const groups = machineGroupId === null
    ? combo.machineGroups
    : combo.machineGroups.filter((group) => group.machineGroupId === machineGroupId)
  if (!groups.length) return null

  const usable = groups.filter((group) => group.usableNow)
  if (usable.length) {
    const transitions = usable
      .map((group) => group.nextTransitionAtMs)
      .filter((value): value is number => typeof value === 'number')
    return {
      label:
        groups.length === 1
          ? 'Dùng được bây giờ'
          : `${usable.length}/${groups.length} nhóm dùng được`,
      usableNow: true,
      nextTransitionAtMs: transitions.length ? Math.min(...transitions) : null,
    }
  }

  const nextStarts = groups
    .map((group) => group.nextUsableAtMs)
    .filter((value): value is number => typeof value === 'number' && value > serverNowMs)
  if (nextStarts.length) {
    const next = Math.min(...nextStarts)
    return {
      label: `Dùng được ${countdownLabel(next, serverNowMs)}`,
      usableNow: false,
      nextTransitionAtMs: next,
    }
  }

  const allInactive = groups.every((group) => group.usageState === 'inactive')
  return {
    label: allInactive ? 'Không hoạt động' : 'Không dùng được hôm nay',
    usableNow: false,
    nextTransitionAtMs: null,
  }
}
