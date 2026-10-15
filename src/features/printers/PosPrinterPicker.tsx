// task web-print-flows — chọn máy in POS + ô "In thông tin phòng máy" dùng chung cho các chỗ in từ Web.
import { useState, type ReactNode } from 'react'
import { CaretDown, CaretUp } from '@phosphor-icons/react'
import { Link } from 'react-router-dom'
import { InlineAlert, Select } from '../../design-system/components'
import type { PosPrinterLike } from './posPrintModel'
import './pos-print.css'

type Props = {
  printers: readonly PosPrinterLike[]
  printerId: number
  onPrinterChange: (printerId: number) => void
  /** `undefined` = ẩn ô "In thông tin phòng máy" (chỗ in không có khối này). */
  roomInfo?: boolean
  onRoomInfoChange?: (value: boolean) => void
  loading?: boolean
  errorMessage?: string
  disabled?: boolean
  idPrefix: string
  /**
   * Gọn (kiểu "Loại nhóm" ở trang user-groups), 3 dòng: (1) ô "In thông tin phòng máy" riêng; (2) nhóm
   * [nhãn | máy in] + `actions` (nút In chính); (3) `secondaryActions`. Cảnh báo/lỗi hiện dưới cùng.
   * Mặc định giữ dạng xếp dọc.
   */
  inline?: boolean
  /** Chế độ `inline`, dòng 2: cùng dòng với ô chọn máy in (nút In chính). */
  actions?: ReactNode
  /** Chế độ `inline`, dòng 3: các nút phụ (in trình duyệt, sao chép, tải file…). */
  secondaryActions?: ReactNode
  /**
   * Chế độ `inline`, kiểu `ds-checkbox-input` của form tìm kiếm nâng cao: ô bật/tắt gộp CHUNG khung với ô chọn máy
   * — `[☐ enableLabel | máy in]`. Bỏ tick ⇒ cả khung mờ, ô chọn máy khóa, ô "In thông tin phòng máy" khóa, ẩn
   * cảnh báo. Có prop này thì khung gộp đứng TRƯỚC, ô "In thông tin phòng máy" nằm dòng dưới.
   */
  enableLabel?: string
  enabled?: boolean
  onEnabledChange?: (value: boolean) => void
  /**
   * Chế độ khung gộp: dòng "Ghi chú" cố định của phiếu (thụt vào dưới ô bật/tắt, cùng cấp "In thông tin phòng
   * máy"). `onNoteCommit` gọi khi rời ô / nhấn Enter để lưu xuống cấu hình. Không truyền `onNoteChange` = ẩn.
   */
  note?: string
  onNoteChange?: (value: string) => void
  onNoteCommit?: () => void
  noteMaxLength?: number
  noteSaving?: boolean
}

export function PosPrinterPicker({
  printers,
  printerId,
  onPrinterChange,
  roomInfo,
  onRoomInfoChange,
  loading = false,
  errorMessage,
  disabled = false,
  idPrefix,
  inline = false,
  actions,
  secondaryActions,
  enableLabel,
  enabled = true,
  onEnabledChange,
  note = '',
  onNoteChange,
  onNoteCommit,
  noteMaxLength = 40,
  noteSaving = false,
}: Props) {
  const selectId = `${idPrefix}-printer`
  // Thu gọn / mở rộng box tùy chọn (chỉ dùng ở chế độ khung gộp có ô bật/tắt). Mặc định THU GỌN mỗi lần mở form,
  // dù ô bật/tắt đang tick hay không; chỉ tự bung ra khi người dùng đổi ô từ bỏ tick sang tick.
  const [expanded, setExpanded] = useState(false)
  const noPrinter = !loading && !errorMessage && printers.length === 0
  const printerOptions =
    printers.length ? (
      printers.map((printer) => (
        <option key={printer.printerId} value={printer.printerId}>
          {printer.printerName}
        </option>
      ))
    ) : (
      <option value={0}>{loading ? 'Đang tải…' : 'Không có máy phù hợp'}</option>
    )
  const alerts = (
    <>
      {errorMessage ? <InlineAlert tone="danger">Không tải được danh sách máy in: {errorMessage}</InlineAlert> : null}
      {noPrinter ? (
        <InlineAlert tone="warning">
          Chưa có máy in POS nào in được từ Web (cần đang hoạt động, có địa chỉ IP, khổ 58/80 mm). Thêm máy ở{' '}
          <Link to="/printers">Cài đặt máy in</Link>.
        </InlineAlert>
      ) : null}
    </>
  )

  if (inline && onEnabledChange) {
    // Bố cục 3 dòng (cha – con):
    //   [☐] In phiếu nạp tiền
    //     Máy in POS | chọn máy |   [☐] In thông tin phòng máy
    //     Ghi chú | ...
    // Bỏ tick dòng cha ⇒ các dòng con ẨN; tick ⇒ sổ xuống.
    return (
      <div className="pos-print-picker pos-print-picker--inline">
        <div className="pos-print-picker__row pos-print-picker__head">
          <label className="pos-print-picker__check pos-print-picker__parent">
            <input
              type="checkbox"
              checked={enabled}
              disabled={disabled}
              onChange={(event) => {
                onEnabledChange(event.target.checked)
                if (event.target.checked) setExpanded(true)
              }}
            />
            <span>{enableLabel}</span>
          </label>
          {enabled ? (
            <button
              type="button"
              className="pos-print-picker__collapse"
              aria-expanded={expanded}
              aria-label={expanded ? 'Thu gọn tùy chọn in' : 'Mở rộng tùy chọn in'}
              title={expanded ? 'Thu gọn' : 'Mở rộng'}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? <CaretUp size={16} weight="bold" aria-hidden="true" /> : <CaretDown size={16} weight="bold" aria-hidden="true" />}
            </button>
          ) : null}
        </div>
        {enabled && expanded ? (
          <div className="pos-print-picker__children">
          <div className="pos-print-picker__row">
            <div className="ds-input-group pos-print-picker__group">
              <label className="ds-input-group-separator" htmlFor={selectId}>
                Máy in POS
              </label>
              <Select
                id={selectId}
                className="ds-select"
                value={printerId}
                disabled={disabled || loading || printers.length === 0}
                onChange={(event) => onPrinterChange(Number(event.target.value))}
              >
                {printerOptions}
              </Select>
            </div>
            {roomInfo !== undefined && onRoomInfoChange ? (
              <label className="pos-print-picker__check">
                <input
                  type="checkbox"
                  checked={roomInfo}
                  disabled={disabled}
                  onChange={(event) => onRoomInfoChange(event.target.checked)}
                />
                <span>In thông tin phòng máy</span>
              </label>
            ) : null}
          </div>
          {onNoteChange ? (
            <div className="pos-print-picker__row">
              <div className="ds-input-group pos-print-picker__group pos-print-picker__note">
                <label className="ds-input-group-separator" htmlFor={`${idPrefix}-note`}>
                  Ghi chú
                </label>
                <input
                  id={`${idPrefix}-note`}
                  className="ds-input"
                  type="text"
                  value={note}
                  maxLength={noteMaxLength}
                  placeholder="In ở cuối phiếu (tối đa 40 ký tự)"
                  disabled={disabled || noteSaving}
                  onChange={(event) => onNoteChange(event.target.value)}
                  onBlur={() => onNoteCommit?.()}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      onNoteCommit?.()
                    }
                  }}
                />
              </div>
            </div>
          ) : null}
        </div>
        ) : null}
        {enabled ? alerts : null}
      </div>
    )
  }

  if (inline) {
    return (
      <div className="pos-print-picker pos-print-picker--inline">
        {roomInfo !== undefined && onRoomInfoChange ? (
          <div className="pos-print-picker__row">
            <label className="pos-print-picker__check">
              <input
                type="checkbox"
                checked={roomInfo}
                disabled={disabled}
                onChange={(event) => onRoomInfoChange(event.target.checked)}
              />
              <span>In thông tin phòng máy</span>
            </label>
          </div>
        ) : null}
        <div className="pos-print-picker__row">
          <div className="ds-input-group pos-print-picker__group">
            <label className="ds-input-group-separator" htmlFor={selectId}>
              Máy in POS
            </label>
            <Select
              id={selectId}
              className="ds-select"
              value={printerId}
              disabled={disabled || loading || printers.length === 0}
              onChange={(event) => onPrinterChange(Number(event.target.value))}
            >
              {printerOptions}
            </Select>
          </div>
          {actions}
        </div>
        {secondaryActions ? <div className="pos-print-picker__row">{secondaryActions}</div> : null}
        {alerts}
      </div>
    )
  }

  return (
    <div className="pos-print-picker">
      <label className="ds-field" htmlFor={selectId}>
        <span className="ds-field__label">Máy in POS</span>
        <Select
          id={selectId}
          value={printerId}
          disabled={disabled || loading || printers.length === 0}
          onChange={(event) => onPrinterChange(Number(event.target.value))}
        >
          {printerOptions}
        </Select>
      </label>

      {roomInfo !== undefined && onRoomInfoChange ? (
        <label className="pos-print-picker__check">
          <input
            type="checkbox"
            checked={roomInfo}
            disabled={disabled}
            onChange={(event) => onRoomInfoChange(event.target.checked)}
          />
          <span>In thông tin phòng máy</span>
        </label>
      ) : null}

      {alerts}
    </div>
  )
}
