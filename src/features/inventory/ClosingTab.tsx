import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  commitClosing,
  getClosingDetail,
  getClosingPreview,
  listClosings,
  type ClosingLine,
} from '../../api/inventory'
import {
  Button,
  ConfirmAction,
  Dialog,
  InlineAlert,
  ListToolbar,
  RefreshButton,
  StateView,
  StatusBadge,
} from '../../design-system/components'
import { useIdempotentIntent } from '../../lib/idempotency'
import { useAuthStore } from '../../store/auth'
import { pushToast } from '../../store/toast'
import { describeInventoryError, diffTone, formatDiff, formatQty, previewHasDiff } from './inventoryModel'

/**
 * Tab Chốt kỳ: xem trước kỳ đang mở (đầu kỳ + nhập − xuất − tiêu hao ± kiểm kê = dự kiến, so với tồn thực) rồi chốt.
 * Chốt = ghi một bản chụp bất biến (materialclosingtb), KHÔNG đổi tồn. Quyền 68.
 */
export function ClosingTab() {
  const queryClient = useQueryClient()
  const canClose = useAuthStore((s) => s.hasRight)(68)
  const { getKey, clearKey } = useIdempotentIntent('closing')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [note, setNote] = useState('')
  const [detailId, setDetailId] = useState<number | null>(null)

  const previewQuery = useQuery({ queryKey: ['inventory', 'closing', 'preview'], queryFn: getClosingPreview })
  const listQuery = useQuery({
    queryKey: ['inventory', 'closing', 'list'],
    queryFn: () => listClosings({ limit: 50 }),
  })

  const commit = useMutation({
    mutationFn: () => commitClosing({ note: note.trim() || undefined, idem: getKey(note.trim()) }),
    onSuccess: (result) => {
      clearKey()
      pushToast(
        `Đã chốt kỳ #${result.closingId}: ${result.materialCount} nguyên liệu, ${result.diffCount} dòng lệch.`,
        'success',
      )
      setConfirmOpen(false)
      setNote('')
      void queryClient.invalidateQueries({ queryKey: ['inventory'] })
    },
    onError: (error) => pushToast(describeInventoryError(error), 'error'),
  })

  const preview = previewQuery.data
  const rows = preview?.rows ?? []
  const hasPeriod = preview?.period !== undefined
  const diffCount = rows.filter(previewHasDiff).length

  return (
    <div className="inv-stack">
      <section className="inv-panel" aria-label="Kỳ đang mở">
        <ListToolbar
          count={
            preview?.period ? (
              <>
                Kỳ đang mở: <strong>{preview.period.fromDate ?? 'từ đầu'}</strong> → <strong>{preview.period.toDate}</strong>
              </>
            ) : (
              <strong>Tồn hiện tại</strong>
            )
          }
          actions={
            <>
              <RefreshButton loading={previewQuery.isFetching} onClick={() => void previewQuery.refetch()} />
              <Button
                type="button"
                variant="primary"
                disabled={!canClose || !hasPeriod || rows.length === 0}
                title={canClose ? undefined : 'Cần quyền Điều chỉnh kho (68)'}
                onClick={() => setConfirmOpen(true)}
              >
                Chốt kỳ
              </Button>
            </>
          }
        />

        {previewQuery.isLoading ? (
          <StateView title="Đang tính kỳ đang mở…" />
        ) : previewQuery.isError ? (
          <StateView
            title="Không tính được kỳ"
            description={describeInventoryError(previewQuery.error)}
            action={
              <Button type="button" onClick={() => void previewQuery.refetch()}>
                Thử lại
              </Button>
            }
          />
        ) : preview?.supported === false ? (
          <StateView title="Cơ sở dữ liệu chưa có bảng nguyên liệu" />
        ) : (
          <>
            {!hasPeriod ? (
              <InlineAlert tone="warning">
                Cơ sở dữ liệu chưa có bảng chốt kỳ nên chưa chốt được; đang hiển thị tồn hiện tại.
              </InlineAlert>
            ) : null}
            {(preview?.warnings.length ?? 0) > 0 ? (
              <InlineAlert tone="warning">
                <strong>{preview?.warnings.length} nguyên liệu sắp hết:</strong>{' '}
                {preview?.warnings.map((w) => `${w.name} (${formatQty(w.stockQty)} ${w.unit})`).join('; ')}
              </InlineAlert>
            ) : null}
            {diffCount > 0 ? (
              <InlineAlert tone="info">
                {diffCount} nguyên liệu có tồn thực khác số dự kiến — thường do hao hụt chưa kiểm kê hoặc nhập/xuất
                ngoài hệ thống.
              </InlineAlert>
            ) : null}
            {rows.length === 0 ? (
              <StateView title="Chưa có nguyên liệu nào" />
            ) : (
              <div className="inv-table-wrap">
                <table className="inv-table">
                  <thead>
                    <tr>
                      <th>Nguyên liệu</th>
                      {hasPeriod ? (
                        <>
                          <th className="is-num">Đầu kỳ</th>
                          <th className="is-num">Nhập</th>
                          <th className="is-num">Xuất</th>
                          <th className="is-num">Tiêu hao</th>
                          <th className="is-num">Kiểm kê</th>
                          <th className="is-num">Dự kiến</th>
                        </>
                      ) : null}
                      <th className="is-num">Tồn thực</th>
                      {hasPeriod ? <th className="is-num">Chênh lệch</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((m) => (
                      <tr key={m.materialId} className={m.isActive === 1 ? '' : 'is-off'}>
                        <td>
                          <strong>{m.name}</strong> <span className="inv-muted">{m.unit}</span>
                        </td>
                        {hasPeriod ? (
                          <>
                            <td className="is-num">{formatQty(m.openingQty)}</td>
                            <td className="is-num">{formatQty(m.importQty)}</td>
                            <td className="is-num">{formatQty(m.exportQty)}</td>
                            <td className="is-num">{formatQty(m.usageQty)}</td>
                            <td className="is-num">{formatDiff(m.adjustQty)}</td>
                            <td className="is-num">{formatQty(m.expectedQty)}</td>
                          </>
                        ) : null}
                        <td className="is-num">
                          <strong>{formatQty(m.stockQty)}</strong>
                          {m.low && m.isActive === 1 ? (
                            <>
                              {' '}
                              <StatusBadge tone="danger" dot={false}>
                                Sắp hết
                              </StatusBadge>
                            </>
                          ) : null}
                        </td>
                        {hasPeriod ? (
                          <td className="is-num">
                            <StatusBadge tone={diffTone(m.diffQty)} dot={false}>
                              {formatDiff(m.diffQty)}
                            </StatusBadge>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>

      <section className="inv-panel" aria-label="Các kỳ đã chốt">
        <ListToolbar count={<strong>Các kỳ đã chốt</strong>} actions={null} />
        {listQuery.isLoading ? (
          <StateView title="Đang tải…" />
        ) : listQuery.isError ? (
          <StateView title="Không tải được danh sách kỳ" description={describeInventoryError(listQuery.error)} />
        ) : listQuery.data?.supported === false ? (
          <StateView title="Cơ sở dữ liệu chưa có bảng chốt kỳ" />
        ) : (listQuery.data?.rows.length ?? 0) === 0 ? (
          <StateView title="Chưa chốt kỳ nào" description="Kỳ đầu tiên tính từ lúc bắt đầu có dữ liệu kho." />
        ) : (
          <div className="inv-table-wrap">
            <table className="inv-table">
              <thead>
                <tr>
                  <th>Kỳ</th>
                  <th>Chốt lúc</th>
                  <th>Người chốt</th>
                  <th className="is-num">Nguyên liệu</th>
                  <th className="is-num">Dòng lệch</th>
                  <th>Ghi chú</th>
                  <th aria-label="Thao tác" />
                </tr>
              </thead>
              <tbody>
                {listQuery.data?.rows.map((c) => (
                  <tr key={c.closingId}>
                    <td>
                      <strong>#{c.closingId}</strong>
                      <small className="inv-muted"> từ {c.fromDate ?? 'đầu'}</small>
                    </td>
                    <td>{c.createDate}</td>
                    <td>{c.staffName}</td>
                    <td className="is-num">{c.materialCount}</td>
                    <td className="is-num">
                      <StatusBadge tone={c.diffCount > 0 ? 'warning' : 'success'} dot={false}>
                        {c.diffCount}
                      </StatusBadge>
                    </td>
                    <td className="inv-muted">{c.note}</td>
                    <td className="inv-table__actions">
                      <Button type="button" variant="outline" onClick={() => setDetailId(c.closingId)}>
                        Chi tiết
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ConfirmAction
        open={confirmOpen}
        title="Chốt kỳ kho nguyên liệu?"
        description="Ghi lại bản chụp tồn đầu/cuối kỳ để đối chiếu. Không thay đổi số tồn; kỳ sau tính từ lúc chốt."
        confirmLabel="Chốt kỳ"
        pending={commit.isPending}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => commit.mutate()}
      >
        <div className="inv-form">
          <p className="inv-form__wide">
            {rows.length} nguyên liệu · <strong>{diffCount}</strong> dòng lệch so với dự kiến.
          </p>
          <label className="ds-field inv-form__wide">
            <span className="ds-field__label">Ghi chú (không bắt buộc)</span>
            <input className="ds-input" value={note} maxLength={255} onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>
      </ConfirmAction>

      <ClosingDetailDialog closingId={detailId} onClose={() => setDetailId(null)} />
    </div>
  )
}

function ClosingDetailDialog({ closingId, onClose }: { closingId: number | null; onClose: () => void }) {
  const query = useQuery({
    queryKey: ['inventory', 'closing', 'detail', closingId],
    queryFn: () => getClosingDetail(closingId ?? 0),
    enabled: closingId !== null,
  })
  if (closingId === null) return null
  const data = query.data
  return (
    <Dialog
      open
      size="lg"
      title={`Kỳ chốt #${closingId}`}
      description={
        data?.createDate
          ? `Chốt ${data.createDate} bởi ${data.staffName ?? ''}${data.note ? ` — ${data.note}` : ''}`
          : undefined
      }
      onClose={onClose}
      footer={
        <Button type="button" variant="secondary" onClick={onClose}>
          Đóng
        </Button>
      }
    >
      {query.isLoading ? (
        <StateView title="Đang tải…" />
      ) : query.isError ? (
        <StateView title="Không tải được chi tiết" description={describeInventoryError(query.error)} />
      ) : (
        <DetailTable rows={data?.rows ?? []} />
      )}
    </Dialog>
  )
}

function DetailTable({ rows }: { rows: ClosingLine[] }) {
  if (rows.length === 0) return <StateView title="Kỳ này không có dòng nào" />
  return (
    <div className="inv-table-wrap">
      <table className="inv-table">
        <thead>
          <tr>
            <th>Nguyên liệu</th>
            <th className="is-num">Đầu kỳ</th>
            <th className="is-num">Nhập</th>
            <th className="is-num">Xuất</th>
            <th className="is-num">Tiêu hao</th>
            <th className="is-num">Kiểm kê</th>
            <th className="is-num">Dự kiến</th>
            <th className="is-num">Cuối kỳ</th>
            <th className="is-num">Lệch</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.materialId}>
              <td>
                {r.materialName} <span className="inv-muted">{r.unit}</span>
              </td>
              <td className="is-num">{formatQty(r.openingQty)}</td>
              <td className="is-num">{formatQty(r.importQty)}</td>
              <td className="is-num">{formatQty(r.exportQty)}</td>
              <td className="is-num">{formatQty(r.usageQty)}</td>
              <td className="is-num">{formatDiff(r.adjustQty)}</td>
              <td className="is-num">{formatQty(r.expectedQty)}</td>
              <td className="is-num">
                <strong>{formatQty(r.closingQty)}</strong>
              </td>
              <td className="is-num">
                <StatusBadge tone={diffTone(r.diffQty)} dot={false}>
                  {formatDiff(r.diffQty)}
                </StatusBadge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
