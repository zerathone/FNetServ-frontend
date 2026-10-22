import { useEffect, useId, useRef } from 'react'
import { CaretDown } from '@phosphor-icons/react'
import type { WsControlResult } from '../../api/workstations'

export type WakeupGroupMachine = {
  hostName: string
}

type WakeupGroupPanelProps = {
  name: string
  machines: WakeupGroupMachine[]
  checked: ReadonlySet<string>
  /** Kết quả lần gửi lệnh gần nhất theo tên máy: máy đã gửi → nền xanh, máy lỗi → nền đỏ (kèm lý do ở tooltip). */
  results: ReadonlyMap<string, WsControlResult>
  open: boolean
  onToggleOpen: () => void
  onToggleMachine: (hostName: string) => void
  onToggleAll: (hostNames: string[], checked: boolean) => void
}

/** Một nhóm máy: [chọn tất cả] [mũi tên + tên nhóm ... đã chọn/tổng], thân là danh sách máy xếp trái→phải, trên→dưới. */
export function WakeupGroupPanel({
  name,
  machines,
  checked,
  results,
  open,
  onToggleOpen,
  onToggleMachine,
  onToggleAll,
}: WakeupGroupPanelProps) {
  const bodyId = useId()
  const checkAllRef = useRef<HTMLInputElement>(null)
  const total = machines.length
  const count = machines.filter((m) => checked.has(m.hostName)).length
  const full = total > 0 && count === total

  useEffect(() => {
    if (checkAllRef.current) checkAllRef.current.indeterminate = count > 0 && !full
  }, [count, full])

  return (
    <div className="ws-mg">
      <div className="ws-mg__head">
        <input
          ref={checkAllRef}
          type="checkbox"
          className="ws-mg__all"
          checked={full}
          aria-label={`Chọn tất cả máy nhóm ${name}`}
          title="Chọn / bỏ chọn tất cả máy trong nhóm"
          onChange={(event) => onToggleAll(machines.map((m) => m.hostName), event.target.checked)}
        />
        <button type="button" className="ws-mg__toggle" aria-expanded={open} aria-controls={bodyId} onClick={onToggleOpen}>
          <CaretDown size={16} weight="bold" aria-hidden="true" className={`ws-mg__caret${open ? ' is-open' : ''}`} />
          <strong className="ws-mg__name">{name}</strong>
          <span className={`ws-mg__count${full ? ' is-full' : ''}`} title="Máy được chọn / tổng số máy trong nhóm">
            {count}/{total}
          </span>
        </button>
      </div>
      {open ? (
        <ul id={bodyId} className="ws-mg__list">
          {machines.map((machine) => {
            const result = results.get(machine.hostName)
            const resultClass = result ? (result.ok ? ' is-sent' : ' is-failed') : ''
            const resultTitle = result ? (result.ok ? 'Đã gửi lệnh mở máy trạm' : `Lỗi: ${result.reason}`) : undefined
            return (
              <li key={machine.hostName}>
                <label className={`ws-mg__item${resultClass}`} title={resultTitle ?? machine.hostName}>
                  <input
                    type="checkbox"
                    checked={checked.has(machine.hostName)}
                    onChange={() => onToggleMachine(machine.hostName)}
                  />
                  <span>{machine.hostName}</span>
                </label>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
