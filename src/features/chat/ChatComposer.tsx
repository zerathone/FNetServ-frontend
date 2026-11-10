import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { PaperPlaneTilt, Smiley } from '@phosphor-icons/react'
import { Button, IconButton } from '../../design-system/components'
import {
  CHAT_TEXT_LIMIT,
  checkDraft,
  countCodePoints,
  EMOJI_GROUPS,
  insertAtSelection,
  normalizeDraft,
} from './chatModel'

const MAX_INPUT_HEIGHT_PX = 132

type Props = {
  /** Gửi bản đã chuẩn hoá. Trả Promise: resolve = đã gửi (xoá ô nhập), reject = giữ lại để gửi lại. */
  onSend: (text: string) => Promise<void>
  disabled?: boolean
  /** Gợi ý dưới ô nhập (vd "tài khoản đang ngoại tuyến"). */
  hint?: string
  /** Đổi hội thoại ⇒ đổi key ở cha để reset bản nháp; prop này chỉ để focus lại khi mở. */
  autoFocus?: boolean
}

/**
 * Ô nhập tin: Enter gửi · Shift+Enter / Alt+Enter xuống dòng · đếm `n/1000` (code point, như server) ·
 * bảng ~48 emoji Unicode. Không gửi khi đang gõ dở bằng bộ gõ tiếng Việt (IME composition).
 */
export function ChatComposer({ onSend, disabled = false, hint, autoFocus = false }: Props) {
  const [value, setValue] = useState('')
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Đếm trên bản ĐÃ chuẩn hoá (cùng bản sẽ gửi) để bộ đếm, nút Gửi và Enter không mâu thuẫn nhau.
  const length = countCodePoints(normalizeDraft(value))
  const overLimit = length > CHAT_TEXT_LIMIT

  // Ô nhập tự cao theo nội dung (tối đa ~6 dòng, quá thì cuộn trong ô).
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_INPUT_HEIGHT_PX)}px`
    // Chỉ hiện thanh cuộn khi nội dung thật sự vượt chiều cao tối đa.
    el.style.overflowY = el.scrollHeight > MAX_INPUT_HEIGHT_PX ? 'auto' : 'hidden'
  }, [value])

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus()
  }, [autoFocus])

  // Bấm ra ngoài bảng emoji ⇒ đóng.
  useEffect(() => {
    if (!emojiOpen) return
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (popoverRef.current?.contains(target)) return
      if ((target as HTMLElement).closest?.('[data-chat-emoji-toggle]')) return
      setEmojiOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [emojiOpen])

  const submit = async () => {
    if (sending || disabled) return
    const check = checkDraft(value)
    if (!check.ok) {
      setError(check.reason === 'empty' ? '' : `Tin nhắn vượt quá ${CHAT_TEXT_LIMIT} ký tự (đang ${check.length}).`)
      return
    }
    setError('')
    setSending(true)
    try {
      await onSend(check.text)
      // Ô nhập bị khoá (readOnly) trong lúc gửi nên `value` không đổi — xoá an toàn, không mất chữ gõ thêm.
      setValue('')
      setEmojiOpen(false)
    } catch (err) {
      // Giữ nguyên bản nháp để gửi lại; cha đã dịch lỗi sang tiếng Việt.
      setError(err instanceof Error ? err.message : 'Không gửi được tin nhắn.')
    } finally {
      setSending(false)
      textareaRef.current?.focus()
    }
  }

  const insertText = (insert: string) => {
    const el = textareaRef.current
    const start = el?.selectionStart ?? value.length
    const end = el?.selectionEnd ?? value.length
    const next = insertAtSelection(value, insert, start, end)
    setValue(next.text)
    // Đặt con trỏ sau chữ vừa chèn khi React đã vẽ lại giá trị mới.
    requestAnimationFrame(() => {
      const target = textareaRef.current
      if (!target) return
      target.focus()
      target.setSelectionRange(next.cursor, next.cursor)
    })
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter') return
    if (sending) {
      event.preventDefault() // đang gửi: không gửi chồng
      return
    }
    // Bộ gõ tiếng Việt (Telex/VNI) dùng Enter để chốt từ — không được coi là "gửi".
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (event.altKey) {
      // Alt+Enter: trình duyệt không tự xuống dòng trong textarea ⇒ tự chèn "\n".
      event.preventDefault()
      insertText('\n')
      return
    }
    if (event.shiftKey) return // Shift+Enter: xuống dòng mặc định
    event.preventDefault()
    void submit()
  }

  return (
    <div
      className="chat-composer"
      onKeyDown={(event) => {
        // Esc ở BẤT KỲ phần tử nào trong khung nhập (ô nhập, nút mặt cười, bảng emoji) khi bảng emoji đang
        // mở: chỉ đóng bảng, không để Drawer nuốt Esc rồi đóng luôn khung chat (mất bản nháp).
        if (event.key === 'Escape' && emojiOpen) {
          event.preventDefault()
          event.stopPropagation()
          setEmojiOpen(false)
          textareaRef.current?.focus()
        }
      }}
    >
      {emojiOpen ? (
        <div ref={popoverRef} className="chat-emoji" role="dialog" aria-label="Chọn biểu tượng">
          {EMOJI_GROUPS.map((group) => (
            <div key={group.label} className="chat-emoji__group">
              <span className="chat-emoji__label">{group.label}</span>
              <div className="chat-emoji__grid">
                {group.items.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className="chat-emoji__item"
                    aria-label={emoji}
                    onClick={() => insertText(emoji)}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* Khung soạn: biểu tượng · ô nhập · nút gửi nằm CÙNG MỘT khung viền. */}
      <div className={`chat-composer__box${overLimit ? ' is-invalid' : ''}`}>
        <span data-chat-emoji-toggle>
          <IconButton
            type="button"
            label="Chèn biểu tượng"
            aria-expanded={emojiOpen}
            className="chat-composer__emoji"
            icon={<Smiley size={22} weight="regular" />}
            disabled={disabled}
            onClick={() => setEmojiOpen((open) => !open)}
          />
        </span>
        <textarea
          ref={textareaRef}
          className="chat-composer__input"
          rows={1}
          value={value}
          disabled={disabled}
          readOnly={sending}
          placeholder="Nhập tin nhắn…"
          aria-label="Nội dung tin nhắn"
          aria-invalid={overLimit}
          onChange={(event) => {
            setValue(event.target.value)
            if (error) setError('')
          }}
          onKeyDown={handleKeyDown}
        />
        <Button
          type="button"
          variant="primary"
          className="chat-composer__send"
          icon={<PaperPlaneTilt size={18} weight="fill" />}
          loading={sending}
          disabled={disabled || overLimit || !value.trim()}
          aria-label="Gửi tin nhắn"
          title="Gửi (Enter)"
          onClick={() => void submit()}
        />
      </div>

      <div className="chat-composer__meta">
        <span className={error ? 'chat-composer__error' : 'chat-composer__hint'} role={error ? 'alert' : undefined}>
          {error || hint || 'Enter gửi · Shift+Enter hoặc Alt+Enter xuống dòng'}
        </span>
        <span className={`chat-composer__count${overLimit ? ' is-over' : ''}`}>
          {length}/{CHAT_TEXT_LIMIT}
        </span>
      </div>
    </div>
  )
}
