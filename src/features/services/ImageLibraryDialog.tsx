import { useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { ArrowLineUp, ImageSquare } from '@phosphor-icons/react'
import { getImageLibrary } from '../../api/serviceCatalog'
import { Button, Dialog, StateView } from '../../design-system/components'
import { describeCatalogError } from './serviceCatalogModel'

const PAGE_SIZE = 30
// Vòng tiến độ của nút "Lên đầu": bán kính 19 trong khung 44 (nét 3) ⇒ chu vi dùng cho stroke-dasharray.
const RING_R = 19
const RING_LEN = 2 * Math.PI * RING_R

/**
 * Thư viện ảnh có sẵn (như iCafe): các ảnh trong thư mục ảnh dùng chung với iCafe, hiện lưới hình thu nhỏ,
 * có tìm theo tên và tự tải thêm khi cuộn (server phân trang vì thư mục có thể hàng trăm ảnh; nút nổi "Lên đầu" kiêm
 * vòng = vị trí cuộn + số ảnh đã tải/tổng dưới nút, user chốt 2026-11-25 thay nút "Xem thêm"). Chọn một ảnh = trả tên file
 * cho form; ảnh KHÔNG được sao chép — món chỉ được gắn tên file đó.
 */
export function ImageLibraryDialog({
  open,
  currentName,
  onClose,
  onPick,
}: {
  open: boolean
  /** Ảnh đang chọn/đang gắn cho món — được đánh dấu trong lưới. */
  currentName: string
  onClose: () => void
  onPick: (name: string) => void
}) {
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')

  // Gõ xong mới tìm (tránh gọi server mỗi phím).
  useEffect(() => {
    const timer = window.setTimeout(() => setQ(search.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [search])

  const query = useInfiniteQuery({
    queryKey: ['services', 'image-library', q],
    queryFn: ({ pageParam }) => getImageLibrary({ offset: pageParam, limit: PAGE_SIZE, q }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, page) => n + page.rows.length, 0)
      return loaded < last.total ? loaded : undefined
    },
    enabled: open,
    staleTime: 5 * 60_000,
  })

  const rows = useMemo(() => query.data?.pages.flatMap((page) => page.rows) ?? [], [query.data])
  const total = query.data?.pages[0]?.total ?? 0
  const gridRef = useRef<HTMLDivElement | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  // Vòng tròn = vị trí cuộn: scrollTop / (scrollHeight − clientHeight), 0..100 (user chốt 2026-11-25).
  const [percent, setPercent] = useState(0)
  const scrolled = percent > 0
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = query

  const syncScroll = () => {
    const el = gridRef.current
    if (!el) return
    const range = el.scrollHeight - el.clientHeight
    setPercent(range > 0 ? Math.min(100, Math.max(0, Math.round((el.scrollTop / range) * 100))) : 0)
  }
  // Tải thêm ảnh làm lưới dài ra ⇒ cùng scrollTop nhưng % đổi, tính lại.
  useEffect(syncScroll, [rows.length])

  // Tự tải trang kế khi mốc cuối lưới lại gần khung cuộn. Dựng lại observer sau mỗi lần tải xong (rows.length đổi) để mốc
  // vẫn còn trong tầm nhìn (lưới chưa đủ dài) thì lại tự tải tiếp. Lỗi tải thì dừng, chờ người dùng bấm "Thử lại".
  useEffect(() => {
    const root = gridRef.current
    const sentinel = sentinelRef.current
    if (!root || !sentinel || !hasNextPage || isFetchingNextPage || isFetchNextPageError) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void fetchNextPage()
      },
      { root, rootMargin: '240px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage, rows.length])

  // Đổi từ khóa tìm ⇒ danh sách mới, về đầu.
  useEffect(() => {
    setPercent(0)
    gridRef.current?.scrollTo({ top: 0 })
  }, [q])

  const scrollToTop = () => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    gridRef.current?.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' })
  }

  return (
    <Dialog
      open={open}
      title="Thư viện hình ảnh"
      size="lg"
      onClose={onClose}
      footer={
        <Button type="button" variant="secondary" onClick={onClose}>
          Đóng
        </Button>
      }
    >
      <div className="svc-lib">
        <input
          className="ds-input"
          type="search"
          value={search}
          placeholder="Tìm theo tên ảnh…"
          aria-label="Tìm ảnh theo tên"
          onChange={(e) => setSearch(e.target.value)}
        />
        {query.isLoading ? (
          <p className="svc-muted">Đang tải…</p>
        ) : query.isError ? (
          <StateView title="Không tải được thư viện ảnh" description={describeCatalogError(query.error)} />
        ) : rows.length === 0 ? (
          <StateView title={q ? 'Không có ảnh phù hợp' : 'Thư viện chưa có ảnh'} />
        ) : (
          <>
            <div className="svc-lib__scroller">
              <div className="svc-lib__grid" ref={gridRef} onScroll={syncScroll}>
                {rows.map((row) => (
                  <button
                    key={row.name}
                    type="button"
                    className={row.name === currentName ? 'svc-lib__item is-current' : 'svc-lib__item'}
                    title={row.name}
                    onClick={() => onPick(row.name)}
                  >
                    <span className="svc-lib__thumb">
                      {row.thumb ? (
                        <img src={`data:${row.mime};base64,${row.thumb}`} alt="" loading="lazy" />
                      ) : (
                        <ImageSquare className="svc-image__placeholder" size={36} weight="light" aria-hidden="true" />
                      )}
                    </span>
                    <span className="svc-lib__name">{row.name}</span>
                  </button>
                ))}
                {/* Mốc cuối lưới: cuộn tới gần là tự tải trang kế tiếp (thay nút "Xem thêm"). */}
                {query.hasNextPage ? <div ref={sentinelRef} className="svc-lib__sentinel" aria-hidden="true" /> : null}
              </div>
              {scrolled || query.hasNextPage ? (
                <div className="svc-lib__float">
                  <button
                    type="button"
                    className={query.isFetchingNextPage ? 'svc-lib__top is-loading' : 'svc-lib__top'}
                    title="Lên đầu danh sách"
                    aria-label={`Lên đầu danh sách. Đã tải ${rows.length} trên ${total} ảnh`}
                    onClick={scrollToTop}
                  >
                    <svg className="svc-lib__ring" viewBox="0 0 44 44" aria-hidden="true">
                      <circle className="svc-lib__ring-track" cx="22" cy="22" r={RING_R} />
                      <circle
                        className="svc-lib__ring-value"
                        cx="22"
                        cy="22"
                        r={RING_R}
                        strokeDasharray={RING_LEN}
                        strokeDashoffset={RING_LEN * (1 - percent / 100)}
                      />
                    </svg>
                    <ArrowLineUp className="svc-lib__top-icon" size={18} weight="bold" aria-hidden="true" />
                  </button>
                  {/* Số ảnh đã tải / tổng, ngay dưới nút. */}
                  <span className="svc-lib__count" aria-hidden="true">
                    {rows.length}/{total}
                  </span>
                </div>
              ) : null}
            </div>
            {query.isFetchNextPageError ? (
              <div className="svc-lib__more">
                <small className="svc-muted">Không tải thêm được ảnh.</small>
                <Button type="button" variant="outline" onClick={() => void fetchNextPage()}>
                  Thử lại
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </Dialog>
  )
}
