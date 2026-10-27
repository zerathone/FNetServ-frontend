import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CaretDown, CheckCircle, Info, XCircle } from '@phosphor-icons/react'
import { OB_RIGHTS } from './onlineBookingModel'

type Props = {
  canApprove: boolean
  onDetail: () => void
  onApprove: () => void
  onReject: () => void
  /** false = chỉ nút "Chi tiết" (đơn đã duyệt: không còn Duyệt / Từ chối). Mặc định true. */
  showMenu?: boolean
  /** Chú thích của nút "Chi tiết". */
  detailTitle?: string
}

/** Chiều cao ước lượng của menu (2 dòng) — chỉ dùng để quyết định mở lên hay xuống. */
const MENU_HEIGHT_ESTIMATE = 80
const MENU_GAP = 4

type MenuPosition = { right: number; top?: number; bottom?: number }

/**
 * Split button cho đơn chờ duyệt: nút chính = "Chi tiết", mũi tên bên phải mở menu "Duyệt" / "Từ chối".
 * Menu vẽ qua portal (position: fixed) vì thẻ timeline nằm trong vùng cuộn có overflow — menu thường sẽ bị cắt.
 */
export function PendingBookingActions({
  canApprove,
  onDetail,
  onApprove,
  onReject,
  showMenu = true,
  detailTitle = 'Chi tiết — xem đơn trong danh sách chờ duyệt',
}: Props) {
  const [position, setPosition] = useState<MenuPosition | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const open = position !== null

  useEffect(() => {
    if (!open) return
    const close = () => setPosition(null)
    const onPointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target as Node
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return
      close()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    // Menu neo theo vị trí lúc mở: cuộn timeline / trang hoặc đổi cỡ cửa sổ thì đóng để khỏi lệch khỏi nút.
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  const toggle = () => {
    if (open) {
      setPosition(null)
      return
    }
    const caret = rootRef.current?.getBoundingClientRect()
    if (!caret) return
    const right = window.innerWidth - caret.right
    const fitsBelow = caret.bottom + MENU_GAP + MENU_HEIGHT_ESTIMATE <= window.innerHeight
    setPosition(
      fitsBelow
        ? { right, top: caret.bottom + MENU_GAP }
        : { right, bottom: window.innerHeight - caret.top + MENU_GAP },
    )
  }

  const choose = (action: () => void) => {
    setPosition(null)
    action()
  }
  const rightHint = canApprove ? undefined : `Cần quyền Duyệt (${OB_RIGHTS.APPROVE})`

  return (
    <>
      <div ref={rootRef} className="ob-split">
        <button
          type="button"
          className="ob-split__main"
          title={detailTitle}
          onClick={onDetail}
        >
          <Info size={16} weight="fill" aria-hidden="true" />
          Chi tiết
        </button>
        {showMenu ? (
          <button
            type="button"
            className="ob-split__caret"
            aria-label="Duyệt hoặc từ chối đơn"
            title="Duyệt / Từ chối"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={toggle}
          >
            <CaretDown size={12} weight="bold" aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {position
        ? createPortal(
            <div ref={menuRef} role="menu" className="ob-split__menu" style={position}>
              <button
                type="button"
                role="menuitem"
                className="ob-split__item ob-split__item--approve"
                disabled={!canApprove}
                title={rightHint}
                onClick={() => choose(onApprove)}
              >
                <CheckCircle size={16} weight="fill" aria-hidden="true" />
                Duyệt
              </button>
              <button
                type="button"
                role="menuitem"
                className="ob-split__item ob-split__item--reject"
                disabled={!canApprove}
                title={rightHint}
                onClick={() => choose(onReject)}
              >
                <XCircle size={16} weight="fill" aria-hidden="true" />
                Từ chối
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
