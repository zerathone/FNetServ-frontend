import type { CSSProperties } from 'react'
import { MagnifyingGlassMinus, MagnifyingGlassPlus } from '@phosphor-icons/react'
import './map.css'

type MapZoomSliderProps = {
  /** Chỉ số mức hiện tại, 0 … labels.length-1. */
  value: number
  /** Nhãn từng mốc (vd "70%") — số phần tử = số mức (≤ 5). */
  labels: readonly string[]
  onChange: (index: number) => void
  ariaLabel: string
}

/**
 * Thanh trượt zoom rời rạc, dựng theo KIỂU Ant Design Slider "with marks" (chỉ mượn kiểu dáng; không dùng thư viện Ant):
 * rail mảnh + track tô tới tay nắm + vạch chia tròn ở từng mức + nhãn mốc bên dưới (bấm được) + bong bóng giá trị
 * hiện trên tay nắm khi rê chuột / kéo / focus bàn phím. Bên dưới vẫn là `input[type=range]` thật nên bàn phím
 * (←/→/Home/End) và đọc màn hình chạy sẵn. Màu lấy từ theme (--color-action-primary) nên hợp cả 4 giao diện.
 */
export function MapZoomSlider({ value, labels, onChange, ariaLabel }: MapZoomSliderProps) {
  const max = Math.max(1, labels.length - 1)
  const percentOf = (index: number) => `${(index / max) * 100}%`

  return (
    <div className="wsmap-zoom">
      <MagnifyingGlassMinus size={18} weight="bold" aria-hidden="true" />
      <div className="wsmap-slider" style={{ '--wsmap-slider-pos': percentOf(value) } as CSSProperties}>
        <div className="wsmap-slider__rail" aria-hidden="true">
          <div className="wsmap-slider__track" />
          {labels.map((label, index) => (
            <span
              key={label}
              className={`wsmap-slider__dot${index <= value ? ' is-active' : ''}`}
              style={{ left: percentOf(index) }}
            />
          ))}
        </div>
        <input
          className="wsmap-slider__input"
          type="range"
          min={0}
          max={labels.length - 1}
          step={1}
          value={value}
          aria-label={ariaLabel}
          aria-valuetext={labels[value]}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <span className="wsmap-slider__tip" aria-hidden="true">
          {labels[value]}
        </span>
        <div className="wsmap-slider__marks">
          {labels.map((label, index) => (
            <button
              key={label}
              type="button"
              tabIndex={-1}
              aria-hidden="true"
              className={`wsmap-slider__mark${index === value ? ' is-active' : ''}`}
              style={{ left: percentOf(index) }}
              onClick={() => onChange(index)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <MagnifyingGlassPlus size={18} weight="bold" aria-hidden="true" />
    </div>
  )
}
