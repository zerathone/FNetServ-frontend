import { useId } from 'react'
import { MagnifyingGlassMinus, MagnifyingGlassPlus } from '@phosphor-icons/react'
import './map.css'

type MapZoomSliderProps = {
  /** Chỉ số mức hiện tại, 0 … levels-1. */
  value: number
  /** Nhãn từng mức (vd "60%") — số phần tử = số mức (≤ 5). */
  labels: readonly string[]
  onChange: (index: number) => void
  ariaLabel: string
}

/** Thanh trượt zoom rời rạc (mỗi nấc = một mức), có vạch chia và nhãn mức hiện tại. */
export function MapZoomSlider({ value, labels, onChange, ariaLabel }: MapZoomSliderProps) {
  const listId = useId()
  const max = labels.length - 1
  return (
    <div className="wsmap-zoom">
      <MagnifyingGlassMinus size={18} weight="bold" aria-hidden="true" />
      <input
        type="range"
        min={0}
        max={max}
        step={1}
        value={value}
        list={listId}
        aria-label={ariaLabel}
        aria-valuetext={labels[value]}
        title={`${ariaLabel}: ${labels[value]}`}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <datalist id={listId}>
        {labels.map((label, index) => (
          <option key={label} value={index} label={label} />
        ))}
      </datalist>
      <MagnifyingGlassPlus size={18} weight="bold" aria-hidden="true" />
      <output>{labels[value]}</output>
    </div>
  )
}
