import { useMemo, useState } from 'react'
import { searchNavEntries, type NavSearchEntry } from './navSearchIndex'

/** State tìm kiếm menu: query + kết quả + dòng đang chọn (bàn phím). Parent dùng `searching` để thay danh sách menu. */
export function useNavSearch(entries: NavSearchEntry[]) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const results = useMemo(() => searchNavEntries(entries, query), [entries, query])
  const searching = query.trim().length > 0

  const updateQuery = (value: string) => {
    setQuery(value)
    setActiveIndex(0)
  }
  const moveActive = (delta: number) => {
    if (results.length === 0) return
    setActiveIndex((index) => (index + delta + results.length) % results.length)
  }
  const clear = () => updateQuery('')

  return { query, setQuery: updateQuery, results, searching, activeIndex, setActiveIndex, moveActive, clear }
}

export type NavSearchState = ReturnType<typeof useNavSearch>
