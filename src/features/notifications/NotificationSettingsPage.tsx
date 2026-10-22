import { useState, type ReactNode } from 'react'
import {
  ArrowCounterClockwise,
  Bell,
  CalendarCheck,
  CaretDown,
  ClipboardText,
  CurrencyCircleDollar,
  DesktopTower,
  PaperPlaneTilt,
  ShieldCheck,
} from '@phosphor-icons/react'
import { Button, InlineAlert, PageHeader, StatusBadge, Switch } from '../../design-system/components'
import { useNotificationPrefs } from '../../store/notificationPrefs'
import { pushToast } from '../../store/toast'
import {
  groupSummary,
  isGroupOn,
  isTypeOn,
  NOTIFICATION_GROUPS,
  SEVERITY_LABEL,
  severityBadgeTone,
  type NotificationGroupDef,
} from './notificationPrefsModel'
import { playNotificationSound } from './notificationSound'
import './notification-settings.css'

const GROUP_ICON: Record<string, ReactNode> = {
  payment: <CurrencyCircleDollar size={24} weight="duotone" />,
  workstation: <DesktopTower size={24} weight="duotone" />,
  order: <ClipboardText size={24} weight="duotone" />,
  booking: <CalendarCheck size={24} weight="duotone" />,
  system: <ShieldCheck size={24} weight="duotone" />,
}

function SettingsCard({
  icon,
  title,
  hint,
  badge,
  control,
  expanded,
  onToggleExpanded,
  dimmed = false,
  children,
}: {
  icon: ReactNode
  title: string
  hint: string
  badge?: ReactNode
  control: ReactNode
  expanded: boolean
  onToggleExpanded: () => void
  dimmed?: boolean
  children: ReactNode
}) {
  return (
    <section className={`notif-settings-card${dimmed ? ' is-dimmed' : ''}`}>
      <header className="notif-settings-card__header">
        <span className="notif-settings-card__icon" aria-hidden="true">
          {icon}
        </span>
        <span className="notif-settings-card__copy">
          <strong>{title}</strong>
          <small>{hint}</small>
        </span>
        {badge}
        {control}
        <button
          type="button"
          className={`notif-settings-card__chevron${expanded ? ' is-open' : ''}`}
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Thu gọn' : 'Mở rộng'} ${title}`}
          onClick={onToggleExpanded}
        >
          <CaretDown size={18} weight="bold" aria-hidden="true" />
        </button>
      </header>
      {expanded ? <div className="notif-settings-card__body">{children}</div> : null}
    </section>
  )
}

function GroupCard({ group }: { group: NotificationGroupDef }) {
  const prefs = useNotificationPrefs()
  const [expanded, setExpanded] = useState(true)
  const groupOn = isGroupOn(prefs, group.id)
  const { on, total } = groupSummary(prefs, group)
  // Công tắc tổng tắt ⇒ cả khối mờ + không bấm được, nhưng KHÔNG xoá lựa chọn riêng của từng loại
  // (bật lại là về đúng trạng thái cũ, giống Windows).
  const locked = !prefs.enabled || !groupOn

  return (
    <SettingsCard
      icon={GROUP_ICON[group.id]}
      title={group.label}
      hint={group.hint}
      dimmed={!prefs.enabled}
      expanded={expanded}
      onToggleExpanded={() => setExpanded((value) => !value)}
      badge={
        <span className="notif-settings-card__count" title="Số loại đang bật / tổng số loại">
          {groupOn ? on : 0}/{total}
        </span>
      }
      control={
        <Switch
          aria-label={`Bật hoặc tắt cả nhóm ${group.label}`}
          checked={groupOn}
          disabled={!prefs.enabled}
          onCheckedChange={(value) => prefs.setGroup(group.id, value)}
        />
      }
    >
      <ul className={`notif-settings-list${locked ? ' is-locked' : ''}`}>
        {group.types.map((item) => (
          <li key={item.type}>
            <Switch
              label={item.label}
              description={
                <>
                  {item.hint}
                  <span className="notif-settings-list__levels">
                    {item.severities.map((severity) => (
                      <StatusBadge key={severity} tone={severityBadgeTone(severity)}>
                        {SEVERITY_LABEL[severity]}
                      </StatusBadge>
                    ))}
                  </span>
                </>
              }
              checked={isTypeOn(prefs, item.type)}
              disabled={locked}
              onCheckedChange={(value) => prefs.setType(item.type, value)}
            />
          </li>
        ))}
      </ul>
    </SettingsCard>
  )
}

export function NotificationSettingsPage() {
  const prefs = useNotificationPrefs()
  const [masterExpanded, setMasterExpanded] = useState(true)

  const sendTest = () => {
    pushToast('Đây là thông báo thử — thông báo nổi đang hoạt động.', 'info')
    if (prefs.sound) playNotificationSound('urgent')
  }

  return (
    <section className="notif-settings-page">
      <PageHeader
        eyebrow="Thông báo"
        title="Thiết lập thông báo"
        description="Chọn loại tin nào được hiện thông báo nổi và phát âm báo. Áp dụng riêng cho trình duyệt này."
        actions={
          <Button
            type="button"
            variant="ghost"
            icon={<ArrowCounterClockwise size={18} weight="bold" />}
            onClick={prefs.reset}
          >
            Khôi phục mặc định
          </Button>
        }
      />

      <InlineAlert tone="info">
        Tắt một loại chỉ ẩn thông báo nổi và âm báo — tin vẫn nằm đủ trong hộp thông báo (biểu tượng
        chuông) để không bỏ sót. Tin mức <strong>Nghiêm trọng</strong> (mất tiền, đã ghi một phần)
        luôn hiện, không tắt được.
      </InlineAlert>

      <SettingsCard
        icon={<Bell size={24} weight="duotone" />}
        title="Thông báo"
        hint="Hiện thông báo nổi khi có tin vận hành mới"
        expanded={masterExpanded}
        onToggleExpanded={() => setMasterExpanded((value) => !value)}
        control={
          <Switch
            aria-label="Bật hoặc tắt toàn bộ thông báo nổi"
            checked={prefs.enabled}
            onCheckedChange={prefs.setEnabled}
          />
        }
      >
        <div className="notif-settings-list">
          <Switch
            label="Phát âm báo khi có tin mới"
            description="Từ mức Cần để ý trở lên; tin Thông tin không kêu. Trình duyệt chỉ cho phát sau khi bạn đã bấm vào trang."
            checked={prefs.sound}
            disabled={!prefs.enabled}
            onCheckedChange={prefs.setSound}
          />
          <div className="notif-settings-list__test">
            <Button
              type="button"
              variant="secondary"
              icon={<PaperPlaneTilt size={18} weight="bold" />}
              onClick={sendTest}
            >
              Gửi thử
            </Button>
          </div>
        </div>
      </SettingsCard>

      {NOTIFICATION_GROUPS.map((group) => (
        <GroupCard key={group.id} group={group} />
      ))}
    </section>
  )
}
