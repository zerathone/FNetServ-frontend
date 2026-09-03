import { useState } from 'react'
import {
  Button,
  ConfirmAction,
  Drawer,
  InlineAlert,
  MoneyInput,
  PageHeader,
  StatusBadge,
} from '../design-system/components'
import { useTheme } from '../design-system/theme/themeContext'

export function ComponentCatalogPage() {
  const { theme, setTheme, themes } = useTheme()
  const [money, setMoney] = useState<number | null>(100_000)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)

  return (
    <section className="catalog-page">
      <PageHeader
        eyebrow="Design system"
        title="Danh mục giao diện"
        description="Kiểm tra control, trạng thái và token trên bốn theme chính thức."
      />

      <div className="catalog-section">
        <h2>Theme</h2>
        <div className="catalog-row">
          {themes.map((item) => (
            <Button
              key={item.id}
              variant={theme === item.id ? 'primary' : 'secondary'}
              onClick={() => setTheme(item.id)}
            >
              {item.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="catalog-section">
        <h2>Hành động</h2>
        <div className="catalog-row">
          <Button variant="primary">Lưu thay đổi</Button>
          <Button variant="secondary">Xem chi tiết</Button>
          <Button variant="ghost">Thao tác khác</Button>
          <Button variant="danger" onClick={() => setConfirmOpen(true)}>Xóa dữ liệu</Button>
          <Button loading>Đang xử lý</Button>
          <Button disabled>Không khả dụng</Button>
        </div>
      </div>

      <div className="catalog-section">
        <h2>Trạng thái</h2>
        <div className="catalog-row">
          <StatusBadge tone="success">Sẵn sàng</StatusBadge>
          <StatusBadge tone="info">Đang chơi</StatusBadge>
          <StatusBadge tone="warning">Cảnh báo</StatusBadge>
          <StatusBadge tone="danger">Chưa thanh toán</StatusBadge>
          <StatusBadge tone="neutral">Mất kết nối</StatusBadge>
        </div>
      </div>

      <div className="catalog-section">
        <h2>Nhập tiền và lớp phủ</h2>
        <div className="catalog-row">
          <div style={{ width: '18rem' }}>
            <MoneyInput
              label="Số tiền"
              value={money}
              onChange={setMoney}
              hint="Định dạng VND, căn phải."
            />
          </div>
          <Button variant="secondary" onClick={() => setDrawerOpen(true)}>
            Mở drawer
          </Button>
          <Button variant="danger" onClick={() => setConfirmOpen(true)}>
            Mở xác nhận
          </Button>
        </div>
      </div>

      <div className="catalog-section">
        <h2>Thông báo tại chỗ</h2>
        <div className="catalog-alerts">
          <InlineAlert tone="info">Thông tin giúp người dùng hoàn thành thao tác.</InlineAlert>
          <InlineAlert tone="success">Thay đổi đã được lưu.</InlineAlert>
          <InlineAlert tone="warning">Kiểm tra lại dữ liệu trước khi tiếp tục.</InlineAlert>
          <InlineAlert tone="danger">Không thể hoàn tất yêu cầu. Dữ liệu chưa thay đổi.</InlineAlert>
        </div>
      </div>

      <Drawer
        open={drawerOpen}
        title="Chi tiết đối tượng"
        description="Drawer giữ nguyên ngữ cảnh của trang."
        onClose={() => setDrawerOpen(false)}
      >
        <p>Nội dung inspector hoặc thao tác nhanh đặt tại đây.</p>
      </Drawer>

      <ConfirmAction
        open={confirmOpen}
        title="Xác nhận thao tác nguy hiểm"
        description="Thông tin mục tiêu và hậu quả phải rõ trước khi xác nhận."
        confirmLabel="Xác nhận xóa"
        danger
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => setConfirmOpen(false)}
      >
        <InlineAlert tone="warning">Dữ liệu sau khi xóa không thể khôi phục từ giao diện.</InlineAlert>
      </ConfirmAction>
    </section>
  )
}
