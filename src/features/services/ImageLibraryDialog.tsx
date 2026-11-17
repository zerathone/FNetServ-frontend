import { useEffect, useMemo, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { ImageSquare } from '@phosphor-icons/react'
import { getImageLibrary } from '../../api/serviceCatalog'
import { Button, Dialog, StateView } from '../../design-system/components'
import { describeCatalogError } from './serviceCatalogModel'

const PAGE_SIZE = 30

/**
 * Thư viện ảnh có sẵn (như iCafe): các ảnh trong thư mục ảnh dùng chung với iCafe, hiện lưới hình thu nhỏ,
 * có tìm theo tên và "Xem thêm" (server phân trang vì thư mục có thể hàng trăm ảnh). Chọn một ảnh = trả tên file
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
            <div className="svc-lib__grid">
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
            </div>
            <div className="svc-lib__more">
              <small className="svc-muted">
                Đang hiện {rows.length}/{total} ảnh
              </small>
              {query.hasNextPage ? (
                <Button
                  type="button"
                  variant="outline"
                  loading={query.isFetchingNextPage}
                  onClick={() => void query.fetchNextPage()}
                >
                  Xem thêm
                </Button>
              ) : null}
            </div>
          </>
        )}
      </div>
    </Dialog>
  )
}
