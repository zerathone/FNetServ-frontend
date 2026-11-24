import { useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  CalendarBlank,
  CalendarCheck,
  Clock,
  Desktop,
  ForkKnife,
  NotePencil,
  Storefront,
  Tag,
  Ticket,
  UserCircle,
} from '@phosphor-icons/react'
import { getComboCardDetail, getUserDetail, type ComboCardDetail, type UserAccount } from '../../api/users'
import { getUserGroups } from '../../api/user-groups'
import { IconButton, InlineAlert, StatusBadge } from '../../design-system/components'
import { CustomerAccountDialog } from './CustomerAccountDialog'
import { describeTimeRange, describeValidity, describeZones, formatDmy } from './comboCardModel'
import {
  daysUntil,
  describeCardStatus,
  describeComboKind,
  describeOrigin,
  describeWeekdays,
  formatDateTime,
  formatRemain,
  formatTimestamp,
  isPastExpiry,
  remainingPercent,
} from './comboCardDetailModel'
import { useAccountPermissions } from './useAccountPermissions'
import { UserEditIcon } from './UserEditIcon'

type Props = {
  /** Hàng đang chọn trong bảng Thẻ combo (đã đổi sang UserAccount). */
  user: UserAccount
}

type StatTone = 'warning' | 'danger'
type Stat = { label: string; value: string; sub?: string; tone?: StatTone }

function formatMoney(value: number) {
  return `${new Intl.NumberFormat('vi-VN').format(value)} đ`
}

/**
 * Ba số liệu cần liếc là hiểu (thanh số ngay dưới tên thẻ):
 *  - Khung giờ cố định: còn bao nhiêu ngày · khung giờ dùng mỗi ngày · ngày hết hạn.
 *  - Theo thời lượng:   còn bao nhiêu giờ · tổng thời lượng · ngày hết hạn.
 * Số sắp hết (≤ 3 ngày / dưới 20% thời lượng) đổi sang màu cảnh báo; đã hết đổi sang màu nguy hiểm.
 */
function buildStats(detail: ComboCardDetail): Stat[] {
  const kind = describeComboKind(detail)
  const expiry = formatDmy(detail.toDate)

  if (kind.kind === 'duration') {
    const used = Boolean(detail.firstLoginAt)
    const percent = remainingPercent(detail)
    const remain: Stat = used
      ? {
          label: 'Còn lại',
          value: formatRemain(detail.remainMinutes),
          tone: detail.remainMinutes <= 0 ? 'danger' : percent !== null && percent < 20 ? 'warning' : undefined,
        }
      : { label: 'Còn lại', value: 'Chưa dùng', sub: 'Tính giờ từ lần đăng nhập đầu' }
    return [
      remain,
      { label: 'Thời lượng', value: detail.duration > 0 ? `${detail.duration} giờ` : '—' },
      expiry
        ? { label: 'Hết hạn', value: expiry, sub: detail.toTime || undefined }
        : { label: 'Hết hạn', value: '—', sub: detail.numOfDay > 0 ? `Hiệu lực ${detail.numOfDay} ngày` : undefined },
    ]
  }

  const days = daysUntil(detail.toDate)
  const timeRange = describeTimeRange(detail)
  // Hết hạn tính theo cả giờ (vd hết lúc 00:00 sáng nay thì hôm nay đã là "Đã hết hạn", không phải "Hết hôm nay").
  const left: Stat =
    days === null
      ? { label: 'Còn lại', value: '—' }
      : days < 0 || isPastExpiry(detail)
        ? { label: 'Còn lại', value: 'Đã hết hạn', tone: 'danger' }
        : days === 0
          ? { label: 'Còn lại', value: 'Hết hôm nay', tone: 'warning' }
          : { label: 'Còn lại', value: `${days} ngày`, tone: days <= 3 ? 'warning' : undefined }
  return [
    left,
    {
      label: 'Khung giờ',
      value: timeRange.kind === 'all-day' ? 'Cả ngày' : timeRange.kind === 'range' ? timeRange.text : '—',
    },
    { label: 'Hết hạn', value: expiry || '—', sub: expiry ? detail.toTime || undefined : undefined },
  ]
}

/** Một dòng thông tin: biểu tượng + nhãn + giá trị (giá trị có thể là chip). */
function Row({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="combo-card-row">
      <dt>
        <span className="combo-card-row__icon" aria-hidden="true">{icon}</span>
        {label}
      </dt>
      <dd>{children}</dd>
    </div>
  )
}

function Chips({ items, zone = false }: { items: string[]; zone?: boolean }) {
  return (
    <span className="combo-card-chips">
      {items.map((item) => (
        <span key={item} className={`combo-card-chip${zone ? ' combo-card-chip--zone' : ''}`}>{item}</span>
      ))}
    </span>
  )
}

export function ComboCardInspector({ user }: Props) {
  const [accountOpen, setAccountOpen] = useState(false)
  const permissions = useAccountPermissions()

  const cardQuery = useQuery({
    queryKey: ['combo-card-detail', user.userId],
    queryFn: () => getComboCardDetail(user.userId),
    retry: false,
  })
  // Hồ sơ tài khoản (GET /user) — nguồn dữ liệu của hộp thoại Tài khoản, dùng chung khóa với hội viên/nhân viên.
  const accountQuery = useQuery({
    queryKey: ['user-detail', user.userId],
    queryFn: () => getUserDetail(user.userId),
    retry: false,
  })
  const groupsQuery = useQuery({
    queryKey: ['user-groups'],
    queryFn: getUserGroups,
    enabled: Boolean(accountQuery.data && accountOpen),
  })
  // Server suy loại tài khoản từ nhóm ⇒ chỉ cho đổi trong các nhóm thẻ combo.
  const comboGroups = useMemo(
    () => (groupsQuery.data ?? []).filter((group) => group.type === 'combo'),
    [groupsQuery.data],
  )

  const detail = cardQuery.data
  const status = detail ? describeCardStatus(detail) : null
  const kind = detail ? describeComboKind(detail) : null
  const origin = detail ? describeOrigin(detail) : null
  const stats = detail ? buildStats(detail) : []
  const percent = detail && kind?.kind === 'duration' ? remainingPercent(detail) : null
  const zones = describeZones(detail?.zone, 99)
  const weekdays = detail ? describeWeekdays(detail.weekday) : null
  const validity = detail ? describeValidity(detail) : null
  const firstLogin = detail ? formatTimestamp(detail.firstLoginAt) : ''
  const note = user.note?.trim()

  return (
    <div className="customer-inspector combo-card-inspector">
      <div className="customer-inspector__hero customer-inspector__hero--member">
        <div className="customer-inspector__identity">
          <div className="customer-avatar" aria-hidden="true">
            <Ticket size={28} weight="duotone" />
          </div>
          <div className="customer-inspector__identity-copy">
            <strong title={detail?.userName ?? user.userName}>{detail?.userName ?? user.userName}</strong>
            <span>{detail ? detail.comboName || 'Không gắn combo' : 'Thẻ combo'}</span>
            <div className="customer-inspector__status-row">
              <div className="customer-inspector__badges">
                {status ? <StatusBadge tone={status.tone}>{status.label}</StatusBadge> : null}
                {kind ? <StatusBadge tone="info" dot={false}>{kind.label}</StatusBadge> : null}
              </div>
            </div>
          </div>
          <IconButton
            type="button"
            variant="secondary"
            className="customer-inspector__account-button"
            label={permissions.canEditAccount ? 'Sửa tài khoản' : 'Bạn không có quyền sửa tài khoản thẻ combo'}
            icon={<UserEditIcon size={26} />}
            disabled={!permissions.canEditAccount || !accountQuery.data}
            onClick={() => setAccountOpen(true)}
          />
        </div>

        {origin ? (
          <div className={`combo-card-origin combo-card-origin--${origin.kind}`}>
            <span className="combo-card-origin__icon" aria-hidden="true">
              {origin.kind === 'member' ? <UserCircle size={20} weight="duotone" /> : <Storefront size={20} weight="duotone" />}
            </span>
            <div>
              <span>{origin.kind === 'member' ? 'Thẻ của hội viên' : 'Nguồn thẻ'}</span>
              <strong>{origin.kind === 'member' ? origin.ownerName : origin.label}</strong>
            </div>
          </div>
        ) : null}
      </div>

      {cardQuery.isLoading ? <p className="combo-card-muted">Đang tải thông tin thẻ…</p> : null}
      {cardQuery.isError ? (
        <InlineAlert tone="warning">
          Không tải được chi tiết thẻ combo. Nếu máy chủ chưa được cập nhật bản mới, hãy cập nhật rồi thử lại.
        </InlineAlert>
      ) : null}

      {detail && weekdays ? (
        <>
          <dl className="combo-card-stats" aria-label="Tình trạng thẻ">
            {stats.map((stat) => (
              <div key={stat.label} className={`combo-card-stat${stat.tone ? ` combo-card-stat--${stat.tone}` : ''}`}>
                <dt>{stat.label}</dt>
                <dd>{stat.value}</dd>
                {stat.sub ? <small>{stat.sub}</small> : null}
              </div>
            ))}
          </dl>
          {percent !== null ? (
            <div
              className={`combo-card-meter${percent < 20 ? ' is-low' : ''}`}
              role="progressbar"
              aria-label="Thời lượng còn lại"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
            >
              <span style={{ width: `${percent}%` }} />
            </div>
          ) : null}

          <section className="combo-card-panel" aria-label="Phạm vi áp dụng">
            <h3 className="combo-card-caption">Phạm vi áp dụng</h3>
            <dl>
              {kind?.kind === 'duration' ? (
                <Row icon={<Clock size={16} weight="bold" />} label="Dùng lần đầu">
                  {firstLogin || <span className="combo-card-muted">Chưa đăng nhập lần nào</span>}
                </Row>
              ) : (
                <Row icon={<Clock size={16} weight="bold" />} label="Hiệu lực">
                  {validity ? (
                    // Hai đầu mốc xếp hai dòng "Từ / Đến": không bị ngắt giữa chừng như một chuỗi dài.
                    <span className="combo-card-range" title={validity.text}>
                      <span><em>Từ</em> {[validity.from.date || '—', validity.from.time].filter(Boolean).join(' ')}</span>
                      <span><em>Đến</em> {[validity.to.date || '—', validity.to.time].filter(Boolean).join(' ')}</span>
                    </span>
                  ) : '—'}
                </Row>
              )}
              <Row icon={<Desktop size={16} weight="bold" />} label="Khu vực">
                {zones ? <Chips items={[...zones.visible, ...zones.hidden]} zone /> : '—'}
              </Row>
              <Row icon={<CalendarBlank size={16} weight="bold" />} label="Ngày dùng">
                {weekdays.all ? weekdays.text : <Chips items={weekdays.days} />}
              </Row>
              <Row icon={<ForkKnife size={16} weight="bold" />} label="Món kèm">
                {detail.donates.length > 0 ? (
                  <Chips
                    items={detail.donates.map(
                      (item) => `${item.name} × ${item.quantity}${item.unit ? ` ${item.unit}` : ''}`,
                    )}
                  />
                ) : (
                  <span className="combo-card-muted">Không có</span>
                )}
              </Row>
            </dl>
          </section>

          <section className="combo-card-panel" aria-label="Thông tin bán">
            <h3 className="combo-card-caption">Thông tin bán</h3>
            <dl>
              <Row icon={<Tag size={16} weight="bold" />} label="Giá hiện tại">
                <strong>{formatMoney(detail.price)}</strong>
                {/* Giá/tên combo lấy từ bảng combo hiện nay, không phải ảnh chụp lúc bán ⇒ có thể khác số tiền khách đã trả. */}
                <small className="combo-card-muted"> theo bảng giá combo hiện nay</small>
              </Row>
              <Row icon={<CalendarCheck size={16} weight="bold" />} label="Ngày bán">
                {formatDateTime(detail.createDate, detail.createTime) || '—'}
              </Row>
              {note ? (
                <Row icon={<NotePencil size={16} weight="bold" />} label="Ghi chú">
                  {note}
                </Row>
              ) : null}
            </dl>
          </section>
        </>
      ) : null}

      <CustomerAccountDialog
        open={accountOpen}
        detail={accountQuery.data}
        noun="thẻ combo"
        groups={comboGroups}
        groupsLoading={groupsQuery.isLoading}
        canModifyBasic={permissions.canModifyBasic}
        canModifyGroup={permissions.canModifyGroup}
        canModifyPassword={permissions.canModifyPassword}
        canModifyUsername={permissions.canModifyUsername}
        onClose={() => setAccountOpen(false)}
      />
    </div>
  )
}
