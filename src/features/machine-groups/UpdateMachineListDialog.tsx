import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { MachineGroup } from '../../api/machine-groups'
import { bulkChangeWorkstationGroup, getWorkstationsRuntime } from '../../api/workstations'
import { Button, Dialog, InlineAlert, Select, StateView } from '../../design-system/components'
import { pushToast } from '../../store/toast'
import { machinesInGroup } from '../workstations/phase2Model'
import { DualListBox } from './DualListBox'

type UpdateMachineListDialogProps = {
  open: boolean
  groups: MachineGroup[]
  canManage: boolean
  onClose: () => void
}

export function UpdateMachineListDialog({ open, groups, canManage, onClose }: UpdateMachineListDialogProps) {
  const queryClient = useQueryClient()
  const [sourceGroupId, setSourceGroupId] = useState(0)
  const [targetGroupId, setTargetGroupId] = useState(0)
  const [selectedHosts, setSelectedHosts] = useState<string[]>([])
  const query = useQuery({
    queryKey: ['workstations'],
    queryFn: getWorkstationsRuntime,
    enabled: open,
  })
  const snapshot = Array.isArray(query.data) ? null : query.data
  const sourceMachines = useMemo(
    () => machinesInGroup(snapshot?.items ?? [], sourceGroupId),
    [snapshot, sourceGroupId],
  )
  const selected = new Set(selectedHosts)
  const availableItems = sourceMachines
    .filter((machine) => !selected.has(machine.hostName))
    .map((machine) => ({ id: machine.hostName, label: machine.hostName, description: machine.ip || 'Không có IP' }))
  const selectedItems = sourceMachines
    .filter((machine) => selected.has(machine.hostName))
    .map((machine) => ({ id: machine.hostName, label: machine.hostName, description: machine.ip || 'Không có IP' }))

  const mutation = useMutation({
    mutationFn: () => bulkChangeWorkstationGroup({ hostNames: selectedHosts, machineGroupId: targetGroupId }),
    onSuccess: ({ results }) => {
      const succeeded = results.filter((result) => result.ok).length
      pushToast(`Đã chuyển ${succeeded}/${results.length} máy sang nhóm mới.`, succeeded === results.length ? 'success' : 'info')
      void queryClient.invalidateQueries({ queryKey: ['workstations'] })
      if (succeeded === results.length) {
        setSelectedHosts([])
        onClose()
      }
    },
    onError: (error) => pushToast(error.message, 'error'),
  })

  const sourceName = sourceGroupId === 0 ? 'Chưa phân nhóm' : groups.find((group) => group.id === sourceGroupId)?.name ?? `Nhóm #${sourceGroupId}`
  const targetName = groups.find((group) => group.id === targetGroupId)?.name ?? 'nhóm đích'

  return (
    <Dialog
      open={open}
      title="Cập nhật danh sách máy"
      description="Chọn nhóm nguồn, nhóm đích và các máy cần điều chuyển hàng loạt."
      size="lg"
      onClose={mutation.isPending ? () => undefined : onClose}
      footer={
        <>
          <Button type="button" variant="secondary" disabled={mutation.isPending} onClick={onClose}>Hủy</Button>
          <Button type="button" variant="primary" loading={mutation.isPending} disabled={!canManage || !targetGroupId || targetGroupId === sourceGroupId || selectedHosts.length === 0} onClick={() => mutation.mutate()}>Chuyển {selectedHosts.length} máy</Button>
        </>
      }
    >
      <div className="machine-transfer-dialog">
        {!canManage ? <InlineAlert tone="warning">Bạn cần quyền Cập nhật danh sách máy (9414).</InlineAlert> : null}
        <div className="machine-transfer-dialog__groups">
          <label className="ds-field">
            <span className="ds-field__label">Nhóm nguồn</span>
            <Select className="ds-select" value={sourceGroupId} onChange={(event) => { setSourceGroupId(Number(event.target.value)); setSelectedHosts([]) }}>
              <option value={0}>Chưa phân nhóm</option>
              {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
            </Select>
          </label>
          <label className="ds-field">
            <span className="ds-field__label">Nhóm đích</span>
            <Select className="ds-select" value={targetGroupId} onChange={(event) => setTargetGroupId(Number(event.target.value))}>
              <option value={0}>Chọn nhóm đích</option>
              {groups.filter((group) => group.id !== sourceGroupId).map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
            </Select>
          </label>
        </div>
        {query.isLoading ? <StateView title="Đang tải danh sách máy…" /> : null}
        {query.isError ? <StateView title="Không tải được danh sách máy" description={(query.error as Error).message} action={<Button onClick={() => query.refetch()}>Thử lại</Button>} /> : null}
        {!query.isLoading && !query.isError ? (
          sourceMachines.length > 0 ? (
            <DualListBox availableTitle={`Máy trong ${sourceName}`} selectedTitle={`Chuyển sang ${targetName}`} availableItems={availableItems} selectedItems={selectedItems} disabled={!canManage || mutation.isPending} onChange={setSelectedHosts} />
          ) : (
            <StateView title={`${sourceName} chưa có máy`} description="Hãy chọn một nhóm nguồn khác." />
          )
        ) : null}
        <InlineAlert tone="info">Máy chủ cập nhật từng máy độc lập. Nếu một máy lỗi, các máy đã chuyển thành công sẽ không bị hoàn tác.</InlineAlert>
      </div>
    </Dialog>
  )
}
