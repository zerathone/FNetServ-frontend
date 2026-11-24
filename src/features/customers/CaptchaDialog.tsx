import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowsClockwise } from '@phosphor-icons/react'
import { Button, Dialog } from '../../design-system/components'
import {
  CAPTCHA_LENGTH,
  attemptsLeft,
  generateCaptchaText,
  isCaptchaMatch,
} from './captchaModel'

const IMAGE_WIDTH = 220
const IMAGE_HEIGHT = 72
// Màu cố định (không theo theme): đây là nội dung ảnh, phải đọc được ở mọi theme.
const GLYPH_COLORS = ['#1f3a5f', '#6b2d5c', '#2f5d3a', '#8a3b12', '#3b3b98', '#7a1f2b']

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min)
}

function drawCaptcha(canvas: HTMLCanvasElement, text: string) {
  const ratio = Math.max(1, window.devicePixelRatio || 1)
  canvas.width = IMAGE_WIDTH * ratio
  canvas.height = IMAGE_HEIGHT * ratio
  const context = canvas.getContext('2d')
  if (!context) return
  context.setTransform(ratio, 0, 0, ratio, 0, 0)

  const gradient = context.createLinearGradient(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT)
  gradient.addColorStop(0, '#f4f1ea')
  gradient.addColorStop(1, '#e4ecf0')
  context.fillStyle = gradient
  context.fillRect(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT)

  for (let index = 0; index < 120; index += 1) {
    context.fillStyle = `rgba(${Math.floor(randomBetween(40, 160))}, ${Math.floor(randomBetween(40, 160))}, ${Math.floor(randomBetween(40, 160))}, 0.45)`
    context.fillRect(randomBetween(0, IMAGE_WIDTH), randomBetween(0, IMAGE_HEIGHT), 2, 2)
  }

  const step = IMAGE_WIDTH / (text.length + 1)
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  for (let index = 0; index < text.length; index += 1) {
    context.save()
    context.translate(step * (index + 1), IMAGE_HEIGHT / 2 + randomBetween(-6, 6))
    context.rotate(randomBetween(-0.45, 0.45))
    context.font = `bold ${Math.round(randomBetween(36, 46))}px "Segoe UI", Arial, sans-serif`
    context.fillStyle = GLYPH_COLORS[Math.floor(Math.random() * GLYPH_COLORS.length)]
    context.fillText(text[index], 0, 0)
    context.restore()
  }

  // Vạch nhiễu vắt qua chữ.
  for (let index = 0; index < 4; index += 1) {
    context.strokeStyle = `rgba(${Math.floor(randomBetween(30, 140))}, ${Math.floor(randomBetween(30, 140))}, ${Math.floor(randomBetween(30, 140))}, 0.7)`
    context.lineWidth = randomBetween(1, 2.2)
    context.beginPath()
    context.moveTo(randomBetween(0, 40), randomBetween(0, IMAGE_HEIGHT))
    context.bezierCurveTo(
      randomBetween(60, 100), randomBetween(0, IMAGE_HEIGHT),
      randomBetween(120, 160), randomBetween(0, IMAGE_HEIGHT),
      randomBetween(180, IMAGE_WIDTH), randomBetween(0, IMAGE_HEIGHT),
    )
    context.stroke()
  }
}

type Props = {
  /** Nhập đúng mã. */
  onVerified: () => void
  /** Người dùng bấm Hủy / Esc / click nền. */
  onCancel: () => void
  /** Sai quá số lần cho phép (parity MFC: đóng hộp thoại, báo mã không đúng). */
  onExhausted: () => void
  title?: string
  description?: string
}

/**
 * Hộp thoại "Mã kiểm tra" (parity MFC): ảnh chữ nhiễu + ô nhập + "Làm mới". Sai ⇒ tự làm mới ảnh và xóa ô nhập;
 * sai đủ `CAPTCHA_MAX_ATTEMPTS` lần ⇒ `onExhausted`. Mount mới mỗi lần mở (mã mới, bộ đếm lỗi về 0).
 */
export function CaptchaDialog({
  onVerified,
  onCancel,
  onExhausted,
  title = 'Mã kiểm tra',
  description = 'Nhập các ký tự trong ảnh để tiếp tục.',
}: Props) {
  const [text, setText] = useState(() => generateCaptchaText())
  const [input, setInput] = useState('')
  const [failed, setFailed] = useState(0)
  const [error, setError] = useState('')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (canvasRef.current) drawCaptcha(canvasRef.current, text)
  }, [text])

  const refresh = useCallback(() => {
    setText(generateCaptchaText())
    setInput('')
    inputRef.current?.focus()
  }, [])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (isCaptchaMatch(text, input)) {
      onVerified()
      return
    }
    const nextFailed = failed + 1
    setFailed(nextFailed)
    if (attemptsLeft(nextFailed) === 0) {
      onExhausted()
      return
    }
    setError(`Mã kiểm tra không đúng. Còn ${attemptsLeft(nextFailed)} lần thử.`)
    refresh()
  }

  return (
    <Dialog
      open
      title={title}
      description={description}
      size="sm"
      onClose={onCancel}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Hủy
          </Button>
          <Button type="submit" form="customer-captcha-form" variant="primary" disabled={input.trim().length === 0}>
            Đồng ý
          </Button>
        </>
      }
    >
      <form id="customer-captcha-form" className="customer-captcha" onSubmit={submit} noValidate>
        <div className="customer-captcha__image-row">
          <canvas
            ref={canvasRef}
            className="customer-captcha__image"
            role="img"
            aria-label={`Hình mã kiểm tra gồm ${CAPTCHA_LENGTH} ký tự chữ và số`}
            style={{ width: IMAGE_WIDTH, height: IMAGE_HEIGHT }}
          />
          <Button
            type="button"
            variant="secondary"
            icon={<ArrowsClockwise size={18} weight="bold" aria-hidden="true" />}
            onClick={() => {
              setError('')
              refresh()
            }}
          >
            Làm mới
          </Button>
        </div>
        <label className="ds-field">
          <span className="ds-field__label">Mã kiểm tra</span>
          <input
            ref={inputRef}
            className="ds-input customer-captcha__input"
            autoFocus
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={CAPTCHA_LENGTH + 3}
            placeholder={`${CAPTCHA_LENGTH} ký tự`}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'customer-captcha-error' : undefined}
            value={input}
            onChange={(event) => {
              setInput(event.target.value)
              if (error) setError('')
            }}
          />
          <span className="ds-field__hint">Không phân biệt chữ hoa, chữ thường.</span>
          {error ? (
            <span id="customer-captcha-error" className="ds-field__error" role="alert">{error}</span>
          ) : null}
        </label>
      </form>
    </Dialog>
  )
}
