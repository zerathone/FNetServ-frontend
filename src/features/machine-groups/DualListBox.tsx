import { useEffect, useMemo, useState } from 'react'
import { CaretDoubleLeft, CaretDoubleRight, CaretLeft, CaretRight } from '@phosphor-icons/react'
import { Button } from '../../design-system/components'
import './machine-groups.css'

export type DualListItem = {
  id: string
  label: string
  description?: string
}

type DualListBoxProps = {
  availableTitle: string
  selectedTitle: string
  availableItems: DualListItem[]
  selectedItems: DualListItem[]
  disabled?: boolean
  onChange: (selectedIds: string[]) => void
}

export function DualListBox({
  availableTitle,
  selectedTitle,
  availableItems,
  selectedItems,
  disabled = false,
  onChange,
}: DualListBoxProps) {
  const [availableSelection, setAvailableSelection] = useState<string[]>([])
  const [selectedSelection, setSelectedSelection] = useState<string[]>([])
  const selectedIds = useMemo(() => selectedItems.map((item) => item.id), [selectedItems])

  useEffect(() => {
    setAvailableSelection([])
    setSelectedSelection([])
  }, [availableItems, selectedItems])

  const add = (ids: string[]) => onChange(Array.from(new Set([...selectedIds, ...ids])))
  const remove = (ids: string[]) => {
    const removed = new Set(ids)
    onChange(selectedIds.filter((id) => !removed.has(id)))
  }

  const renderList = (
    title: string,
    items: DualListItem[],
    value: string[],
    onSelectionChange: (ids: string[]) => void,
  ) => (
    <section className="dual-list-box__panel">
      <header>
        <strong>{title}</strong>
        <span>{items.length}</span>
      </header>
      <select
        multiple
        value={value}
        disabled={disabled || items.length === 0}
        aria-label={title}
        onChange={(event) =>
          onSelectionChange(Array.from(event.currentTarget.selectedOptions, (option) => option.value))
        }
      >
        {items.map((item) => (
          <option key={item.id} value={item.id} title={item.description}>
            {item.label}{item.description ? ` · ${item.description}` : ''}
          </option>
        ))}
      </select>
      <small>Giữ Ctrl để chọn nhiều dòng.</small>
    </section>
  )

  return (
    <div className="dual-list-box">
      {renderList(availableTitle, availableItems, availableSelection, setAvailableSelection)}
      <div className="dual-list-box__actions" aria-label="Điều chuyển danh sách">
        <Button type="button" variant="secondary" icon={<CaretRight size={18} weight="bold" aria-hidden="true" />} disabled={disabled || availableSelection.length === 0} onClick={() => add(availableSelection)} aria-label="Chuyển các mục đã chọn sang phải" />
        <Button type="button" variant="secondary" icon={<CaretDoubleRight size={18} weight="bold" aria-hidden="true" />} disabled={disabled || availableItems.length === 0} onClick={() => add(availableItems.map((item) => item.id))} aria-label="Chuyển tất cả sang phải" />
        <Button type="button" variant="secondary" icon={<CaretLeft size={18} weight="bold" aria-hidden="true" />} disabled={disabled || selectedSelection.length === 0} onClick={() => remove(selectedSelection)} aria-label="Chuyển các mục đã chọn sang trái" />
        <Button type="button" variant="secondary" icon={<CaretDoubleLeft size={18} weight="bold" aria-hidden="true" />} disabled={disabled || selectedItems.length === 0} onClick={() => onChange([])} aria-label="Chuyển tất cả sang trái" />
      </div>
      {renderList(selectedTitle, selectedItems, selectedSelection, setSelectedSelection)}
    </div>
  )
}
