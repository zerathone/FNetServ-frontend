import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSystemFunctions, updateSystemFunctions } from '../../api/workstations'
import { Button, Dialog, InlineAlert, StateView } from '../../design-system/components'
import { pushToast } from '../../store/toast'
import { DualListBox, type DualListItem } from '../machine-groups/DualListBox'
import { systemFunctionName } from './phase2Model'
import { ApiError } from '../../api/client'
import './workstations.css'

type ClientSystemFunctionDialogProps = {
  open: boolean
  canManage: boolean
  onClose: () => void
}

export function ClientSystemFunctionDialog({ open, canManage, onClose }: ClientSystemFunctionDialogProps) {
  const queryClient = useQueryClient()
  const [blockedIds, setBlockedIds] = useState<string[]>([])
  const query = useQuery({
    queryKey: ['workstations', 'system-functions'],
    queryFn: getSystemFunctions,
    enabled: open,
  })

  useEffect(() => {
    if (!open || !query.data) return
    setBlockedIds(query.data.items.filter((item) => item.status === 1).map((item) => String(item.resourceId)))
  }, [open, query.data])

  const items = useMemo<DualListItem[]>(
    () =>
      (query.data?.items ?? [])
        .map((item) => ({
          id: String(item.resourceId),
          label: item.name?.trim() || systemFunctionName(item.resourceId),
        }))
        .sort((left, right) => left.label.localeCompare(right.label, 'vi')),
    [query.data],
  )
  const blocked = new Set(blockedIds)
  const allowedItems = items.filter((item) => !blocked.has(item.id))
  const blockedItems = items.filter((item) => blocked.has(item.id))

  const mutation = useMutation({
    mutationFn: () =>
      updateSystemFunctions({
        items: items.map((item) => ({
          resourceId: Number(item.id),
          status: blocked.has(item.id) ? 1 : 0,
        })),
      }),
    onSuccess: ({ updated, items: results }) => {
      const failed = results.filter((item) => !item.ok).length
      pushToast(
        failed
          ? `Đã cập nhật ${updated} chức năng; ${failed} mục lỗi cần kiểm tra lại.`
          : `Đã cập nhật ${updated} chức năng hệ thống máy trạm.`,
        failed ? 'info' : 'success',
      )
      void queryClient.invalidateQueries({ queryKey: ['workstations', 'system-functions'] })
      if (!failed) onClose()
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'SYSTEM_FUNCTION_PARTIAL_UPDATE') {
        const details = error.details as { updated?: number; items?: Array<{ ok: boolean }> } | undefined
        const failed = details?.items?.filter((item) => !item.ok).length ?? 0
        pushToast(`Máy chủ chỉ cập nhật ${details?.updated ?? 0} mục; ${failed} mục lỗi. Đã tải lại trạng thái thật.`, 'error')
        void queryClient.invalidateQueries({ queryKey: ['workstations', 'system-functions'] })
        return
      }
      pushToast(error.message, 'error')
    },
  })

  return (
    <Dialog
      open={open}
      title="Chức năng hệ thống máy trạm"
      description="Chuyển chức năng giữa danh sách được phép và bị cấm; thay đổi được phát tới các client đang hoạt động."
      size="lg"
      onClose={mutation.isPending ? () => undefined : onClose}
      footer={
        <>
          <Button type="button" variant="secondary" disabled={mutation.isPending} onClick={onClose}>Hủy</Button>
          <Button type="button" variant="primary" loading={mutation.isPending} disabled={!canManage || items.length === 0} onClick={() => mutation.mutate()}>Lưu chính sách</Button>
        </>
      }
    >
      <div className="ws-dialog-stack">
        {!canManage ? <InlineAlert tone="warning">Chỉ tài khoản quản trị viên được thay đổi chính sách này.</InlineAlert> : null}
        {query.isLoading ? <StateView title="Đang tải chính sách…" /> : null}
        {query.isError ? <StateView title="Không tải được chính sách" description={(query.error as Error).message} action={<Button onClick={() => query.refetch()}>Thử lại</Button>} /> : null}
        {!query.isLoading && !query.isError && items.length === 0 ? <StateView title="Chưa có chức năng hệ thống" description="Bảng SystemfunctionTb chưa có dữ liệu." /> : null}
        {items.length > 0 ? (
          <DualListBox
            availableTitle="Được phép"
            selectedTitle="Bị cấm"
            availableItems={allowedItems}
            selectedItems={blockedItems}
            disabled={!canManage || mutation.isPending}
            onChange={setBlockedIds}
          />
        ) : null}
        <InlineAlert tone="info">Trạng thái “Bị cấm” tương ứng giá trị 1 trong contract máy chủ.</InlineAlert>
      </div>
    </Dialog>
  )
}
