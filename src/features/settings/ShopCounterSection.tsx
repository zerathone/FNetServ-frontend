import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  SHOP_COUNTER_SIZE_MAX,
  SHOP_COUNTER_SIZE_MIN,
  updateShopCounterSettings,
  type ShopCounterUpdate,
} from '../../api/settings'
import { Button, InlineAlert, StateView, Switch } from '../../design-system/components'
import { SHOP_COUNTER_QUERY_KEY, useMaterialFeature } from '../inventory/useMaterialFeature'
import { pushToast } from '../../store/toast'
import { SettingsConfirmDialog } from './SettingsConfirmDialog'

/** Số nguyên trong khoảng cho phép; chuỗi rỗng / lẻ / ngoài khoảng ⇒ null. */
function parseSize(text: string): number | null {
  if (!/^\d{1,5}$/.test(text.trim())) return null
  const value = Number(text)
  return value >= SHOP_COUNTER_SIZE_MIN && value <= SHOP_COUNTER_SIZE_MAX ? value : null
}

const SIZE_ERROR = `Nhập số nguyên từ ${SHOP_COUNTER_SIZE_MIN} đến ${SHOP_COUNTER_SIZE_MAX}.`

/**
 * Cài đặt → Đơn hàng → "Bán kèm và kho nguyên liệu" (GET|PUT /settings/shop-counter, PUT chỉ ADMIN).
 * Cùng một cài đặt với iCafe (option -2003, chuỗi `token;cao;rộng` của FFood quầy): bật/tắt ở đâu thì phía kia thấy ngay.
 * Có thể sửa cao/rộng cửa sổ FFood quầy; token giữ nguyên. Chỉ gửi ô đã đổi, nên không đè lên cao/rộng mà iCafe vừa đặt.
 * Chỉ nói về KHO NGUYÊN LIỆU — kho hàng hóa (thành phẩm) ở trang Dịch vụ & hàng hóa không bị ảnh hưởng.
 */
export function ShopCounterSection({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient()
  const { data, isLoading } = useMaterialFeature()
  const [draftEnabled, setDraftEnabled] = useState<boolean | null>(null)
  const [draftHeight, setDraftHeight] = useState<string | null>(null)
  const [draftWidth, setDraftWidth] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const enabled = data?.enabled ?? null
  const checked = draftEnabled ?? enabled ?? false
  const heightText = draftHeight ?? String(data?.height ?? 640)
  const widthText = draftWidth ?? String(data?.width ?? 1280)
  const height = parseSize(heightText)
  const width = parseSize(widthText)

  const enabledDirty = enabled !== null && checked !== enabled
  // Cao/rộng chỉ có nghĩa khi tính năng bật; gửi cả hai nếu một trong hai đổi so với giá trị đang lưu.
  const sizeDirty = checked && data !== undefined && (heightText.trim() !== String(data.height) || widthText.trim() !== String(data.width))
  const sizeInvalid = checked && (height === null || width === null)
  const dirty = enabledDirty || sizeDirty

  const reset = () => {
    setDraftEnabled(null)
    setDraftHeight(null)
    setDraftWidth(null)
    setConfirmOpen(false)
  }

  const mutation = useMutation({
    mutationFn: updateShopCounterSettings,
    onSuccess: (result) => {
      queryClient.setQueryData(SHOP_COUNTER_QUERY_KEY, result)
      reset()
      pushToast(
        result.changed === false
          ? 'Cài đặt bán kèm và kho nguyên liệu đã đúng như vậy từ trước.'
          : 'Đã lưu cài đặt bán kèm và kho nguyên liệu.',
        result.changed === false ? 'info' : 'success',
      )
    },
    onError: (err: Error) => {
      setConfirmOpen(false)
      pushToast(err.message, 'error')
      // Mất phản hồi vẫn có thể là máy chủ đã đổi (hoặc iCafe vừa đổi) ⇒ đọc lại giá trị thật.
      void queryClient.invalidateQueries({ queryKey: SHOP_COUNTER_QUERY_KEY })
    },
  })

  const buildPatch = (): ShopCounterUpdate => {
    const patch: ShopCounterUpdate = {}
    if (enabledDirty) patch.enabled = checked
    if (sizeDirty && height !== null && width !== null) {
      patch.height = height
      patch.width = width
    }
    return patch
  }

  const requestSave = (event: FormEvent) => {
    event.preventDefault()
    if (!isAdmin || !dirty || sizeInvalid) return
    // Bật hoặc đổi kích thước áp dụng ngay; tắt ảnh hưởng nghiệp vụ nên hỏi lại.
    if (checked) mutation.mutate(buildPatch())
    else setConfirmOpen(true)
  }

  const fieldsDisabled = !isAdmin || !checked || mutation.isPending

  return (
    <form id="setting-shop-counter" className="settings-section settings-section--compact" onSubmit={requestSave}>
      <header>
        <h2>Bán kèm và kho nguyên liệu</h2>
        <p>
          Bật: món bán kèm (topping), tự trừ nguyên liệu theo công thức khi duyệt đơn, mục Nguyên liệu trên menu, và nút “Bán tại
          quầy” của phần mềm máy chủ mở FFood. Đây là cùng một cài đặt với iCafe.
        </p>
      </header>
      {isAdmin ? null : <InlineAlert tone="warning">Chỉ quản trị viên được đổi cài đặt này.</InlineAlert>}
      {isLoading ? (
        <StateView title="Đang tải cấu hình" />
      ) : data === undefined ? (
        <StateView
          title="Không tải được cài đặt"
          description="Máy chủ chưa hỗ trợ cài đặt này (cần cập nhật Server) hoặc mất kết nối."
          action={<Button onClick={() => void queryClient.invalidateQueries({ queryKey: SHOP_COUNTER_QUERY_KEY })}>Thử lại</Button>}
        />
      ) : (
        <>
          <div className="settings-toggle-list">
            <Switch
              checked={checked}
              onCheckedChange={setDraftEnabled}
              disabled={!isAdmin || mutation.isPending}
              label="Bán kèm và kho nguyên liệu"
              description="Tắt = không bán kèm, không trừ nguyên liệu khi duyệt đơn, ẩn mục Nguyên liệu. Kho hàng hóa (thành phẩm) không bị ảnh hưởng."
            />
          </div>

          <div className="settings-form-grid">
            <label className="ds-field">
              <span className="ds-field__label">Chiều cao cửa sổ FFood quầy (px)</span>
              <input
                className="ds-input"
                type="number"
                inputMode="numeric"
                min={SHOP_COUNTER_SIZE_MIN}
                max={SHOP_COUNTER_SIZE_MAX}
                step={1}
                value={heightText}
                disabled={fieldsDisabled}
                aria-invalid={checked && height === null}
                onChange={(event) => setDraftHeight(event.target.value)}
              />
              {checked && height === null ? <small role="alert">{SIZE_ERROR}</small> : <small>Mặc định 640.</small>}
            </label>
            <label className="ds-field">
              <span className="ds-field__label">Chiều rộng cửa sổ FFood quầy (px)</span>
              <input
                className="ds-input"
                type="number"
                inputMode="numeric"
                min={SHOP_COUNTER_SIZE_MIN}
                max={SHOP_COUNTER_SIZE_MAX}
                step={1}
                value={widthText}
                disabled={fieldsDisabled}
                aria-invalid={checked && width === null}
                onChange={(event) => setDraftWidth(event.target.value)}
              />
              {checked && width === null ? <small role="alert">{SIZE_ERROR}</small> : <small>Mặc định 1280.</small>}
            </label>
          </div>

          {data.schemaReady === false ? (
            <InlineAlert tone="warning">
              Cơ sở dữ liệu chưa có bảng kho nguyên liệu nên bật cũng chưa có tác dụng. Cần nâng cấp cơ sở dữ liệu của máy chủ.
            </InlineAlert>
          ) : null}
          <p className="ops-hint">
            Trạng thái đang lưu trên máy chủ: {data.enabled ? 'đang bật' : 'đang tắt'}
            {data.enabled && !data.hasSize ? ', chưa khai báo cao/rộng (đang dùng mặc định 640 × 1280)' : ''}. Bật/tắt có hiệu lực
            ngay. Cao/rộng áp dụng cho cửa sổ FFood quầy khi mở lại phần mềm máy chủ. Tắt không xóa dữ liệu nguyên liệu, công thức
            hay lịch sử; bật lại là dùng tiếp với đúng token và kích thước cũ.
          </p>
          <footer>
            <Button
              type="submit"
              variant="primary"
              disabled={!isAdmin || !dirty || sizeInvalid}
              loading={mutation.isPending && !confirmOpen}
            >
              Lưu cài đặt
            </Button>
          </footer>
        </>
      )}
      <SettingsConfirmDialog
        open={confirmOpen}
        title="Tắt bán kèm và kho nguyên liệu?"
        consequences={[
          'Nhân viên không tạo được đơn có món bán kèm (topping).',
          'Duyệt đơn không còn tự trừ nguyên liệu theo công thức; mục Nguyên liệu ẩn khỏi menu.',
          'Nút “Bán tại quầy” của phần mềm máy chủ chuyển về màn hình đặt món cũ, không mở FFood.',
          'iCafe cũng thấy cài đặt này tắt. Hoàn nguyên liệu khi hủy đơn và báo cáo cũ vẫn hoạt động.',
        ]}
        danger
        pending={mutation.isPending}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => mutation.mutate(buildPatch())}
      />
    </form>
  )
}
