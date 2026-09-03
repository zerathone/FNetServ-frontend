import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { generateUsers } from '../../api/users'
import { getUserGroups } from '../../api/user-groups'
import {
  Button,
  ConfirmAction,
  Dialog,
  InlineAlert,
  MoneyInput,
  Select,
  StateView,
} from '../../design-system/components'
import { pushToast } from '../../store/toast'
import { CredentialOutputDialog } from '../printers/CredentialOutputDialog'
import type { MemberCredential } from '../printers/credentialPrintModel'
import './customers.css'

type Props = {
  open: boolean
  onClose: () => void
}

export function AutoGenerateMemberDialog({ open, onClose }: Props) {
  const queryClient = useQueryClient()
  const [prefix, setPrefix] = useState('HV')
  const [startNum, setStartNum] = useState(1)
  const [endNum, setEndNum] = useState(10)
  const [userGroupId, setUserGroupId] = useState(0)
  const [initialMoney, setInitialMoney] = useState<number | null>(0)
  const [expiryDate, setExpiryDate] = useState('')
  const [note, setNote] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [generated, setGenerated] = useState<MemberCredential[]>([])
  const [skipped, setSkipped] = useState<string[]>([])

  const groupsQuery = useQuery({
    queryKey: ['user-groups', 'member-generation'],
    queryFn: getUserGroups,
    enabled: open,
  })
  const groups = useMemo(
    () => (groupsQuery.data ?? []).filter((group) => group.typeCode === 2 && group.active),
    [groupsQuery.data],
  )
  const selectedGroupId = userGroupId || groups[0]?.id || 0
  const count = endNum - startNum + 1
  const prefixInvalid = !prefix.trim() || prefix.trim().length > 20 || /['"\\]/.test(prefix)
  const invalid = prefixInvalid || startNum < 0 || endNum > 999 || startNum > endNum ||
    !selectedGroupId || initialMoney === null || initialMoney < 0 || note.length > 255

  const mutation = useMutation({
    retry: false,
    mutationFn: () => generateUsers({
      prefix: prefix.trim(),
      startNum,
      endNum,
      userGroupId: selectedGroupId,
      initialMoney: initialMoney ?? 0,
      expiryDate,
      note: note.trim(),
    }),
    onSuccess: (response) => {
      setConfirmOpen(false)
      setGenerated(response.created.map((user) => ({
        kind: 'member',
        username: user.username,
        password: user.password,
        initialMoney: initialMoney ?? 0,
        expiry: expiryDate,
      })))
      setSkipped(response.skipped)
      pushToast(`Đã tạo ${response.created.length} hội viên. Hãy lưu mật khẩu trước khi đóng.`, 'success')
      void queryClient.invalidateQueries({ queryKey: ['users'] })
    },
    onError: (error: Error) => {
      setConfirmOpen(false)
      pushToast(error.message, 'error')
    },
  })

  const close = () => {
    if (mutation.isPending) return
    setConfirmOpen(false)
    setGenerated([])
    setSkipped([])
    onClose()
  }

  if (generated.length) {
    return (
      <CredentialOutputDialog
        open={open}
        records={generated}
        skipped={skipped}
        sourceLabel="Mật khẩu chỉ được máy chủ trả về trong lần tạo này."
        onClose={close}
      />
    )
  }

  return (
    <>
      <Dialog
        open={open}
        title="Tạo hội viên tự động"
        description="Sinh dải tài khoản liên tiếp, sau đó xuất Text hoặc in POS/A4."
        size="md"
        onClose={close}
        footer={
          <>
            <Button type="button" variant="secondary" disabled={mutation.isPending} onClick={close}>Hủy</Button>
            <Button type="button" variant="primary" disabled={invalid || groupsQuery.isLoading} onClick={() => setConfirmOpen(true)}>
              Kiểm tra và tạo {Math.max(0, count)} tài khoản
            </Button>
          </>
        }
      >
        {groupsQuery.isError ? (
          <StateView
            title="Không tải được nhóm hội viên"
            description={(groupsQuery.error as Error).message}
            action={<Button onClick={() => void groupsQuery.refetch()}>Thử lại</Button>}
          />
        ) : (
          <div className="member-generate-form">
            <label className="ds-field">
              <span className="ds-field__label">Tiền tố tài khoản</span>
              <input className="ds-input" maxLength={20} value={prefix} onChange={(event) => setPrefix(event.target.value)} />
              {prefixInvalid ? <span className="ds-field__error">Bắt buộc, tối đa 20 ký tự và không chứa dấu nháy hoặc dấu gạch chéo.</span> : null}
            </label>
            <label className="ds-field">
              <span className="ds-field__label">Số bắt đầu (000–999)</span>
              <input className="ds-input" type="number" min={0} max={999} value={startNum} onChange={(event) => setStartNum(Number(event.target.value))} />
            </label>
            <label className="ds-field">
              <span className="ds-field__label">Số kết thúc (000–999)</span>
              <input className="ds-input" type="number" min={0} max={999} value={endNum} onChange={(event) => setEndNum(Number(event.target.value))} />
            </label>
            <label className="ds-field">
              <span className="ds-field__label">Nhóm hội viên</span>
              <Select value={selectedGroupId} disabled={groupsQuery.isLoading || !groups.length} onChange={(event) => setUserGroupId(Number(event.target.value))}>
                {groups.length ? groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>) : <option value={0}>Không có nhóm đang hoạt động</option>}
              </Select>
            </label>
            <MoneyInput
              label="Số tiền ban đầu"
              value={initialMoney}
              min={0}
              onChange={setInitialMoney}
              error={initialMoney !== null && initialMoney < 0 ? 'Số tiền không được âm.' : undefined}
            />
            <label className="ds-field">
              <span className="ds-field__label">Ngày hết hạn</span>
              <input className="ds-input" type="date" value={expiryDate} onChange={(event) => setExpiryDate(event.target.value)} />
              <span className="ds-field__hint">Để trống nếu không giới hạn.</span>
            </label>
            <label className="ds-field member-generate-form__wide">
              <span className="ds-field__label">Ghi chú</span>
              <textarea className="ds-input" maxLength={255} value={note} onChange={(event) => setNote(event.target.value)} />
              <span className="ds-field__hint">{note.length}/255 ký tự</span>
            </label>
            <InlineAlert tone="warning">
              Mỗi tài khoản được tạo kèm mật khẩu ngẫu nhiên. Hãy xuất file hoặc in trước khi đóng kết quả.
            </InlineAlert>
          </div>
        )}
      </Dialog>

      <ConfirmAction
        open={confirmOpen}
        title={`Tạo ${Math.max(0, count)} hội viên?`}
        description={`Dải dự kiến: ${prefix.trim()}${String(startNum).padStart(3, '0')} – ${prefix.trim()}${String(endNum).padStart(3, '0')}.`}
        confirmLabel="Xác nhận tạo"
        pending={mutation.isPending}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => mutation.mutate()}
      >
        <InlineAlert tone="warning">Tài khoản trùng sẽ được bỏ qua và báo trong kết quả.</InlineAlert>
      </ConfirmAction>
    </>
  )
}
