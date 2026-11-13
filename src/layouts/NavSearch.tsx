import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { MagnifyingGlass, X } from '@phosphor-icons/react'
import type { NavSearchEntry, NavSearchResult } from './navSearchIndex'
import type { NavSearchState as SearchState } from './useNavSearch'

type NavSearchBoxProps = {
  search: SearchState
  collapsed: boolean
  onExpand: () => void
  onSelect: (entry: NavSearchEntry) => void
}

export function NavSearchBox({ search, collapsed, onExpand, onSelect }: NavSearchBoxProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const focusAfterExpand = useRef(false)

  // Ctrl/⌘+K: nhảy vào ô tìm kiếm từ bất cứ trang nào (sidebar đang thu gọn thì mở rộng ra trước).
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return
      event.preventDefault()
      if (collapsed) {
        focusAfterExpand.current = true
        onExpand()
      } else {
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [collapsed, onExpand])

  useEffect(() => {
    if (!collapsed && focusAfterExpand.current) {
      focusAfterExpand.current = false
      inputRef.current?.focus()
    }
  }, [collapsed])

  if (collapsed) {
    return (
      <div className="nav-search nav-search--collapsed">
        <button
          type="button"
          className="nav-search__icon-button"
          aria-label="Tìm kiếm chức năng (Ctrl+K)"
          title="Tìm kiếm chức năng (Ctrl+K)"
          onClick={() => {
            focusAfterExpand.current = true
            onExpand()
          }}
        >
          <MagnifyingGlass size={20} weight="bold" />
        </button>
      </div>
    )
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      search.moveActive(1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      search.moveActive(-1)
    } else if (event.key === 'Enter') {
      const picked = search.results[search.activeIndex]
      if (picked) {
        event.preventDefault()
        onSelect(picked.entry)
      }
    } else if (event.key === 'Escape') {
      if (search.query) search.clear()
      else inputRef.current?.blur()
    }
  }

  return (
    <div className="nav-search" role="search">
      <label className="nav-search__field">
        <MagnifyingGlass className="nav-search__glyph" size={16} weight="bold" aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          className="nav-search__input"
          placeholder="Tìm chức năng, cài đặt…"
          aria-label="Tìm chức năng hoặc cài đặt"
          aria-controls="nav-search-results"
          aria-activedescendant={search.searching && search.results.length > 0 ? `nav-search-option-${search.activeIndex}` : undefined}
          autoComplete="off"
          spellCheck={false}
          value={search.query}
          onChange={(event) => search.setQuery(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {search.query ? (
          <button
            type="button"
            className="nav-search__clear"
            aria-label="Xóa từ khóa"
            onClick={() => {
              search.clear()
              inputRef.current?.focus()
            }}
          >
            <X size={14} weight="bold" />
          </button>
        ) : (
          <kbd className="nav-search__kbd" aria-hidden="true">Ctrl K</kbd>
        )}
      </label>
    </div>
  )
}

type NavSearchResultsProps = {
  search: SearchState
  getIcon: (entry: NavSearchEntry) => ReactNode
  onSelect: (entry: NavSearchEntry) => void
}

export function NavSearchResults({ search, getIcon, onSelect }: NavSearchResultsProps) {
  const activeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [search.activeIndex, search.results])

  if (search.results.length === 0) {
    return (
      <div className="nav-search__empty" role="status">
        Không tìm thấy “{search.query.trim()}”. Thử từ khóa ngắn hơn hoặc gõ không dấu.
      </div>
    )
  }

  return (
    <div id="nav-search-results" className="nav-search__results" role="listbox" aria-label="Kết quả tìm kiếm">
      <div className="nav-search__count" role="status">
        {search.results.length} kết quả
      </div>
      {search.results.map(({ entry, hint }: NavSearchResult, index) => {
        const active = index === search.activeIndex
        return (
          <button
            key={entry.key}
            id={`nav-search-option-${index}`}
            ref={active ? activeRef : undefined}
            type="button"
            role="option"
            aria-selected={active}
            className={active ? 'nav-search__result nav-search__result--active' : 'nav-search__result'}
            onMouseMove={() => search.setActiveIndex(index)}
            onClick={() => onSelect(entry)}
          >
            <span className="nav-search__result-icon" aria-hidden="true">{getIcon(entry)}</span>
            <span className="nav-search__result-text">
              <strong>{entry.label}</strong>
              <small>{entry.trail}</small>
              {hint ? <em>khớp: {hint}</em> : null}
            </span>
            {entry.kind === 'setting' ? <span className="nav-search__tag">Cài đặt</span> : null}
          </button>
        )
      })}
    </div>
  )
}
