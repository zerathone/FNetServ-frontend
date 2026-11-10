import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowBendUpLeft, Lock, PaperPlaneTilt, Smiley, X } from '@phosphor-icons/react'
import { Button, IconButton } from '../../design-system/components'
import {
  CHAT_TEXT_LIMIT,
  checkDraft,
  countCodePoints,
  EMOJI_GROUPS,
  formatCountdown,
  insertAtSelection,
  normalizeDraft,
  remainingLockSec,
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
  /** Đang trả lời tin nào (hiện ô "Đang trả lời …" phía trên khung soạn; ✕ hoặc Esc để huỷ). */
  replyTo?: { id: number; who: string; text: string } | null
  onCancelReply?: () => void
  /** epoch ms khoá gửi tin (chống dồn tin). Còn khoá ⇒ ô nhập chỉ đọc, nút Gửi tắt, Enter không gửi; bản nháp được giữ. */
  lockedUntil?: number
  /** Gọi 1 lần khi đếm ngược về 0 để cha xoá cờ khoá. */
  onLockExpired?: () => void
}

/**
 * Ô nhập tin: Enter gửi · Shift+Enter / Alt+Enter xuống dòng · đếm `n/1000` (code point, như server) ·
 * bảng ~48 emoji Unicode. Không gửi khi đang gõ dở bằng bộ gõ tiếng Việt (IME composition).
 */
export function ChatComposer({
  onSend,
  disabled = false,
  hint,
  autoFocus = false,
  replyTo = null,
  onCancelReply,
  lockedUntil = 0,
  onLockExpired,
}: Props) {
  const [value, setValue] = useState('')
  // Đồng hồ khoá: chỉ chạy khi đang khoá; hết khoá thì báo cha xoá cờ (một lần).
  const [now, setNow] = useState(() => Date.now())
  const lockSec = remainingLockSec(lockedUntil, now)
  const locked = lockSec > 0
  useEffect(() => {
    if (lockedUntil <= Date.now()) return
    setNow(Date.now())
    const timer = setInterval(() => {
      const current = Date.now()
      setNow(current)
      if (current >= lockedUntil) {
        clearInterval(timer)
        onLockExpired?.()
      }
    }, 500)
    return () => clearInterval(timer)
  }, [lockedUntil, onLockExpired])
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Vừa bị khoá: xoá câu lỗi "gửi quá nhanh" của lần gửi vừa rồi (nếu không nó hiện lại ngay khi hết khoá — ô nhập
  // chỉ đọc nên người dùng không có cách nào làm `onChange` xoá nó) và đóng bảng emoji (khoá thì không chèn thêm).
  useEffect(() => {
    if (!locked) return
    setError('')
    setEmojiOpen(false)
  }, [locked])

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

  // Bấm "Trả lời" ở một dòng tin ⇒ đưa con trỏ vào ô nhập để gõ luôn.
  const replyId = replyTo?.id
  useEffect(() => {
    if (replyId) textareaRef.current?.focus()
  }, [replyId])

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
    if (sending || disabled || locked) return
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
    if (locked) return // đang khoá gửi tin: ô nhập chỉ đọc, không chèn emoji/xuống dòng
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
    if (sending || locked) {
      event.preventDefault() // đang gửi / đang khoá chống dồn tin: Enter KHÔNG có tác dụng
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
          return
        }
        // Esc khi đang trả lời (bảng emoji đóng): chỉ huỷ trả lời, không để Drawer đóng khung chat.
        if (event.key === 'Escape' && replyTo && onCancelReply) {
          event.preventDefault()
          event.stopPropagation()
          onCancelReply()
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

      {replyTo ? (
        <div className="chat-composer__reply">
          <ArrowBendUpLeft size={16} aria-hidden="true" />
          <span className="chat-composer__reply-text">
            Đang trả lời <strong>{replyTo.who}</strong>: {replyTo.text}
          </span>
          <IconButton
            type="button"
            label="Huỷ trả lời"
            className="chat-composer__reply-cancel"
            icon={<X size={16} />}
            onClick={() => onCancelReply?.()}
          />
        </div>
      ) : null}

      {/* Khung soạn: biểu tượng · ô nhập · nút gửi nằm CÙNG MỘT khung viền. */}
      <div className={`chat-composer__box${overLimit ? ' is-invalid' : ''}${locked ? ' is-locked' : ''}`}>
        <span data-chat-emoji-toggle>
          <IconButton
            type="button"
            label="Chèn biểu tượng"
            aria-expanded={emojiOpen}
            className="chat-composer__emoji"
            icon={<Smiley size={22} weight="regular" />}
            disabled={disabled || locked}
            onClick={() => setEmojiOpen((open) => !open)}
          />
        </span>
        <textarea
          ref={textareaRef}
          className="chat-composer__input"
          rows={1}
          value={value}
          disabled={disabled}
          readOnly={sending || locked}
          placeholder={locked ? 'Tạm khoá gửi tin…' : 'Nhập tin nhắn…'}
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
          disabled={disabled || locked || overLimit || !value.trim()}
          aria-label="Gửi tin nhắn"
          title="Gửi (Enter)"
          onClick={() => void submit()}
        />
      </div>

      <div className="chat-composer__meta">
        {locked ? (
          <span className="chat-composer__error">
            <Lock size={12} aria-hidden="true" />{' '}
            {/* Con số đổi mỗi giây: ẩn khỏi trình đọc màn hình (nếu không nó đọc lại suốt 1–3 phút). */}
            <span aria-hidden="true">
              Bạn gửi tin quá nhanh — khoá gửi tin còn {formatCountdown(lockSec)}
              {value.trim() ? ' (bản nháp được giữ lại)' : ''}
            </span>
            <span className="chat-sr-only" role="status">
              Đang bị khoá gửi tin vì gửi quá nhanh.
            </span>
          </span>
        ) : (
          <span className={error ? 'chat-composer__error' : 'chat-composer__hint'} role={error ? 'alert' : undefined}>
            {error || hint || 'Enter gửi · Shift+Enter hoặc Alt+Enter xuống dòng'}
          </span>
        )}
        <span className={`chat-composer__count${overLimit ? ' is-over' : ''}`}>
          {length}/{CHAT_TEXT_LIMIT}
        </span>
      </div>
    </div>
  )
}
