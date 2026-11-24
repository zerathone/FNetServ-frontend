import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getMachineGroups } from '../../api/machine-groups'
import { getUserGroups } from '../../api/user-groups'
import { Button, ConfirmAction, InlineAlert, PageHeader, Segmented, Select, StateView } from '../../design-system/components'
import { useAuthStore } from '../../store/auth'
import { supportsUserGroupPricingAndPromotion } from '../user-groups/userGroupModel'
import { DiscountPanel } from './DiscountPanel'
import { MemberPanel } from './MemberPanel'
import { TimePanel } from './TimePanel'
import './promotions.css'

const RIGHT_PROMOTION = 54

type Tab = 'member' | 'time' | 'discount'

const TAB_LABELS: Record<Tab, { label: string; title: string }> = {
  member: { label: 'Nạp tiền', title: 'Tặng thêm khi hội viên nạp tiền' },
  time: { label: 'Khung giờ vàng', title: 'Giá riêng theo giờ trong ngày và ngày trong tuần' },
  discount: { label: 'Giảm giá theo giờ chơi', title: 'Giá theo từng đợt giờ khách đã chơi' },
}

export function PromotionWorkspace() {
  const hasRight = useAuthStore((state) => state.hasRight)
  const canSave = hasRight(RIGHT_PROMOTION)
  const [pickedGroupId, setPickedGroupId] = useState<number | null>(null)
  const [pickedTab, setPickedTab] = useState<Tab>('member')
  // Tab nào đang có thay đổi chưa lưu (các tab được giữ nguyên khi chuyển qua lại; chỉ đổi nhóm người dùng mới bỏ).
  const [dirtyTabs, setDirtyTabs] = useState<Record<Tab, boolean>>({ member: false, time: false, discount: false })
  const [pendingGroupId, setPendingGroupId] = useState<number | null>(null)
  const setDirty = useMemo(
    () => ({
      member: (value: boolean) => setDirtyTabs((current) => (current.member === value ? current : { ...current, member: value })),
      time: (value: boolean) => setDirtyTabs((current) => (current.time === value ? current : { ...current, time: value })),
      discount: (value: boolean) => setDirtyTabs((current) => (current.discount === value ? current : { ...current, discount: value })),
    }),
    [],
  )

  const userGroupsQuery = useQuery({ queryKey: ['user-groups'], queryFn: getUserGroups })
  const machineGroupsQuery = useQuery({ queryKey: ['machine-groups'], queryFn: getMachineGroups })

  const groups = (userGroupsQuery.data ?? []).filter(supportsUserGroupPricingAndPromotion)
  const group = groups.find((item) => item.id === pickedGroupId) ?? groups[0]
  const isAnonymous = group?.typeCode === 1
  // Nạp tiền chỉ có nghĩa với hội viên: nhóm khách vãng lai không có tab này.
  const tabs: Tab[] = isAnonymous ? ['time', 'discount'] : ['member', 'time', 'discount']
  const tab = tabs.includes(pickedTab) ? pickedTab : tabs[0]
  const dirtyNames = tabs.filter((value) => dirtyTabs[value]).map((value) => TAB_LABELS[value].label)

  const requestGroup = (id: number) => {
    if (!group || id === group.id) return
    if (dirtyNames.length > 0) setPendingGroupId(id)
    else setPickedGroupId(id)
  }

  return (
    <section className="promo-workspace">
      <PageHeader
        eyebrow="Thiết lập khuyến mãi"
        title="Khuyến mãi"
        description="Chọn nhóm người dùng, rồi đặt khuyến mãi áp dụng cho nhóm đó. Mỗi tab lưu riêng."
      />

      {canSave ? null : <InlineAlert tone="warning">Bạn chỉ xem được khuyến mãi. Cần quyền Khuyến mãi (54) để thay đổi.</InlineAlert>}

      {userGroupsQuery.isLoading ? (
        <StateView title="Đang tải nhóm người dùng…" />
      ) : userGroupsQuery.isError ? (
        <StateView
          title="Không tải được nhóm người dùng"
          description={userGroupsQuery.error instanceof Error ? userGroupsQuery.error.message : undefined}
          action={<Button onClick={() => void userGroupsQuery.refetch()}>Thử lại</Button>}
        />
      ) : !group ? (
        <StateView title="Chưa có nhóm người dùng hỗ trợ khuyến mãi" description="Hãy tạo nhóm khách vãng lai hoặc hội viên ở trang Nhóm người dùng." />
      ) : (
        <>
          <div className="promo-toolbar">
            <label className="ds-field promo-toolbar__group">
              <span className="ds-field__label">Nhóm người dùng</span>
              <Select
                className="ds-select"
                value={group.id}
                aria-label="Nhóm người dùng"
                onChange={(event) => requestGroup(Number(event.target.value))}
              >
                {/* Tên nhóm canh trái, loại (khách vãng lai / hội viên) canh phải — cùng kiểu combo mặt hàng + nhóm ở phiếu kho. */}
                {groups.map((item) => (
                  <option key={item.id} value={item.id}>
                    <span className="ds-option-name">{item.name}</span>
                    <strong className="ds-option-tag">{item.typeCode === 1 ? 'Khách vãng lai' : 'Hội viên'}</strong>
                  </option>
                ))}
              </Select>
            </label>
            <div className="promo-toolbar__tabs">
              <Segmented
                ariaLabel="Loại khuyến mãi"
                value={tab}
                options={tabs.map((value) => ({
                  value,
                  label: dirtyTabs[value] ? `${TAB_LABELS[value].label} •` : TAB_LABELS[value].label,
                  title: dirtyTabs[value] ? `${TAB_LABELS[value].title} — có thay đổi chưa lưu` : TAB_LABELS[value].title,
                }))}
                onChange={setPickedTab}
              />
            </div>
          </div>

          {/* Giữ cả ba tab trong DOM (chỉ ẩn tab không xem) để chuyển tab không mất phần đang soạn. */}
          {isAnonymous ? null : (
            <div hidden={tab !== 'member'}>
              <MemberPanel priceId={group.id} canSave={canSave} onDirtyChange={setDirty.member} />
            </div>
          )}
          <div hidden={tab !== 'time'}>
            <TimePanel
              priceId={group.id}
              isAnonymous={isAnonymous}
              machineGroups={machineGroupsQuery.data ?? []}
              canSave={canSave}
              onDirtyChange={setDirty.time}
            />
          </div>
          <div hidden={tab !== 'discount'}>
            <DiscountPanel
              priceId={group.id}
              machineGroups={machineGroupsQuery.data ?? []}
              canSave={canSave}
              onDirtyChange={setDirty.discount}
            />
          </div>

          <ConfirmAction
            open={pendingGroupId !== null}
            danger
            title="Bỏ thay đổi chưa lưu?"
            description={`Đổi nhóm người dùng sẽ bỏ các thay đổi chưa lưu ở: ${dirtyNames.join(', ')}.`}
            confirmLabel="Bỏ thay đổi và chuyển nhóm"
            onCancel={() => setPendingGroupId(null)}
            onConfirm={() => {
              setPickedGroupId(pendingGroupId)
              setPendingGroupId(null)
            }}
          />
        </>
      )}
    </section>
  )
}
