import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getUsers, usersApi } from '../api/users'
import { InlineAlert, ListPagination } from '../design-system/components'
import { AutoGenerateMemberDialog } from '../features/customers/AutoGenerateMemberDialog'
import { fingerprintIntent, useIdempotentIntent } from '../lib/idempotency'
import { pushToast as showToast } from '../store/toast';


function formatMoney(value: number) {
  return new Intl.NumberFormat('vi-VN').format(value) + ' đ'
}

function maskSensitiveInfo(str: string | undefined): string {
  if (!str) return '';
  const s = str.trim();
  if (s.length <= 7) return s;
  return s.slice(0, 3) + '*'.repeat(s.length - 7) + s.slice(-4);
}

type UserType = 'member' | 'staff' | 'combo'

export function UsersPage() {
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const routeSearch = searchParams.get('search')?.trim() ?? ''
  const [activeTab, setActiveTab] = useState<UserType>('member')
  const [searchTerm, setSearchTerm] = useState(routeSearch)
  const [searchQuery, setSearchQuery] = useState(routeSearch)
  const [page, setPage] = useState(0)
  const limit = 50

  useEffect(() => {
    setActiveTab('member')
    setSearchTerm(routeSearch)
    setSearchQuery(routeSearch)
    setPage(0)
  }, [routeSearch])

  // Modals state
  const [isGenerateModalOpen, setIsGenerateModalOpen] = useState(false)
  const [isCleanModalOpen, setIsCleanModalOpen] = useState(false)
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false)
  const [selectedUser, setSelectedUser] = useState<any>(null)

  // Generate states

  // Clean states
  const [cleanMonths, setCleanMonths] = useState(6)
  const [cleanIgnoreBalance, setCleanIgnoreBalance] = useState(false)
  const [cleanCandidates, setCleanCandidates] = useState<any[]>([])

  // Context Panel state
  const [selectedUserForPanel, setSelectedUserForPanel] = useState<any>(null)

  // Pay Debt state
  const [isPayDebtModalOpen, setIsPayDebtModalOpen] = useState(false)
  const [debtAmount, setDebtAmount] = useState<number>(0)

  // Deposit state
  const [isDepositModalOpen, setIsDepositModalOpen] = useState(false)
  const [depositAmount, setDepositAmount] = useState<number>(10000)
  const [depositNote, setDepositNote] = useState<string>('')

  // Credit state
  const [isCreditModalOpen, setIsCreditModalOpen] = useState(false)
  const [creditAmount, setCreditAmount] = useState<number>(0)

  // Give Free state
  const [isGiveFreeModalOpen, setIsGiveFreeModalOpen] = useState(false)
  const [giveFreeAmount, setGiveFreeAmount] = useState<number>(0)

  // Transfer state
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false)
  const [transferAmount, setTransferAmount] = useState<number>(0)
  const [transferToUserId, setTransferToUserId] = useState<number>(0)
  const payDebtIntent = useIdempotentIntent('pay-debt')
  const depositIntent = useIdempotentIntent('deposit')
  const creditIntent = useIdempotentIntent('credit')
  const giveFreeIntent = useIdempotentIntent('give-free')
  const transferIntent = useIdempotentIntent('transfer')
  
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['users', activeTab, page, searchQuery],
    queryFn: () => getUsers(activeTab, limit, page * limit, searchQuery),
  })

  // History query
  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ['userHistory', selectedUser?.userId],
    queryFn: () => usersApi.getRechargeHistory(selectedUser!.userId),
    enabled: !!selectedUser && isHistoryModalOpen
  })

  // Mutations
  const loadCleanCandidatesMutation = useMutation({
    mutationFn: () => usersApi.getCleanCandidates(cleanMonths, cleanIgnoreBalance),
    onSuccess: (data: any) => {
      setCleanCandidates(Array.isArray(data) ? data : (data.data || []))
    },
    onError: (err: any) => showToast(`Lỗi: ${err.message}`, 'error')
  })

  const deleteBatchMutation = useMutation({
    mutationFn: () => usersApi.deleteBatch(cleanCandidates.map(c => c.Id || c.userId)),
    onSuccess: () => {
      showToast(`Đã xóa ${cleanCandidates.length} hội viên`, 'success')
      setIsCleanModalOpen(false)
      setCleanCandidates([])
      queryClient.invalidateQueries({ queryKey: ['users', 'member'] })
    },
    onError: (err: any) => showToast(`Lỗi: ${err.message}`, 'error')
  })

  const payDebtMutation = useMutation({
    mutationFn: () => usersApi.payDebt({
      userId: selectedUserForPanel.userId,
      amount: debtAmount,
      idem: payDebtIntent.getKey(
        fingerprintIntent({ userId: selectedUserForPanel.userId, amount: debtAmount }),
      ),
    }),
    onSuccess: () => {
      payDebtIntent.clearKey()
      showToast('Trả nợ thành công', 'success')
      setIsPayDebtModalOpen(false)
      setDebtAmount(0)
      queryClient.invalidateQueries({ queryKey: ['users', 'member'] })
    },
    onError: (err: any) => showToast(`Lỗi: ${err.message}`, 'error')
  })

  const depositMutation = useMutation({
    mutationFn: () => usersApi.deposit({
      userId: selectedUserForPanel.userId,
      chargeMoney: depositAmount,
      paymentMethod: 'cash',
      note: depositNote,
      idem: depositIntent.getKey(
        fingerprintIntent({
          userId: selectedUserForPanel.userId,
          chargeMoney: depositAmount,
          note: depositNote,
        }),
      ),
    }),
    onSuccess: () => {
      depositIntent.clearKey()
      showToast('Nạp tiền thành công', 'success')
      setIsDepositModalOpen(false)
      setDepositAmount(0)
      setDepositNote('')
      queryClient.invalidateQueries({ queryKey: ['users', 'member'] })
    },
    onError: (err: any) => showToast(`Lỗi: ${err.message}`, 'error')
  })

  const creditMutation = useMutation({
    mutationFn: () => usersApi.credit({
      userId: selectedUserForPanel.userId,
      borrowMoney: creditAmount,
      idem: creditIntent.getKey(
        fingerprintIntent({ userId: selectedUserForPanel.userId, borrowMoney: creditAmount }),
      ),
    }),
    onSuccess: () => {
      creditIntent.clearKey()
      showToast('Cho mượn tiền thành công', 'success')
      setIsCreditModalOpen(false)
      setCreditAmount(0)
      queryClient.invalidateQueries({ queryKey: ['users', 'member'] })
    },
    onError: (err: any) => showToast(`Lỗi: ${err.message}`, 'error')
  })

  const giveFreeMutation = useMutation({
    mutationFn: () => usersApi.giveFree({
      userId: selectedUserForPanel.userId,
      giveMoney: giveFreeAmount,
      idem: giveFreeIntent.getKey(
        fingerprintIntent({ userId: selectedUserForPanel.userId, giveMoney: giveFreeAmount }),
      ),
    }),
    onSuccess: () => {
      giveFreeIntent.clearKey()
      showToast('Tặng tiền/giờ thành công', 'success')
      setIsGiveFreeModalOpen(false)
      setGiveFreeAmount(0)
      queryClient.invalidateQueries({ queryKey: ['users', 'member'] })
    },
    onError: (err: any) => showToast(`Lỗi: ${err.message}`, 'error')
  })

  const transferMutation = useMutation({
    mutationFn: () => usersApi.transfer({
      fromUserId: selectedUserForPanel.userId,
      toUserId: transferToUserId,
      transferMoney: transferAmount,
      idem: transferIntent.getKey(
        fingerprintIntent({
          fromUserId: selectedUserForPanel.userId,
          toUserId: transferToUserId,
          transferMoney: transferAmount,
        }),
      ),
    }),
    onSuccess: () => {
      transferIntent.clearKey()
      showToast('Chuyển tiền thành công', 'success')
      setIsTransferModalOpen(false)
      setTransferAmount(0)
      queryClient.invalidateQueries({ queryKey: ['users', 'member'] })
    },
    onError: (err: any) => showToast(`Lỗi: ${err.message}`, 'error')
  })

  const users = data?.items ?? []
  const filteredUsers = users

  const openHistory = (user: any) => {
    setSelectedUser(user)
    setIsHistoryModalOpen(true)
  }

  return (
    <section className="page-card" style={{ position: 'relative', display: 'flex', padding: 0, overflow: 'hidden', height: 'calc(100vh - 48px)' }}>
      
      {/* Main Content Area */}
      <div style={{ flex: 1, padding: '2rem', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div className="page-header">
          <div>
            <p className="eyebrow">Phase 3 · Task 3.10</p>
            <h2 className="section-title">Quản lý Tài khoản</h2>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {activeTab === 'member' && (
              <>
                <button type="button" className="secondary-button" onClick={() => setIsGenerateModalOpen(true)}>
                  Tạo tự động
                </button>
                <button type="button" className="secondary-button" onClick={() => setIsCleanModalOpen(true)} style={{ color: 'var(--text-error)' }}>
                  Dọn dẹp
                </button>
              </>
            )}
            <button type="button" className="primary-button">
              Thêm mới {activeTab === 'member' ? 'hội viên' : activeTab === 'staff' ? 'nhân viên' : 'thẻ combo'}
            </button>
          </div>
        </div>

        <p className="page-description" style={{ marginBottom: 0 }}>Quản lý danh sách hội viên, nhân viên và thẻ combo, nạp tiền, khóa/mở thẻ và cấp lại mật khẩu.</p>

        <div style={{ display: 'flex', gap: '1rem', borderBottom: '1px solid var(--border)', marginBottom: '1.5rem', marginTop: '1rem' }}>
          <button 
            className={`tab-button ${activeTab === 'member' ? 'active' : ''}`}
            onClick={() => { setActiveTab('member'); setPage(0); setSelectedUserForPanel(null); }}
            style={{ padding: '0.5rem 1rem', background: 'transparent', border: 'none', borderBottom: activeTab === 'member' ? '2px solid var(--primary)' : '2px solid transparent', cursor: 'pointer', fontWeight: 500, color: activeTab === 'member' ? 'var(--primary)' : 'var(--text-secondary)' }}
          >
            Hội viên
          </button>
          <button 
            className={`tab-button ${activeTab === 'combo' ? 'active' : ''}`}
            onClick={() => { setActiveTab('combo'); setPage(0); setSelectedUserForPanel(null); }}
            style={{ padding: '0.5rem 1rem', background: 'transparent', border: 'none', borderBottom: activeTab === 'combo' ? '2px solid var(--primary)' : '2px solid transparent', cursor: 'pointer', fontWeight: 500, color: activeTab === 'combo' ? 'var(--primary)' : 'var(--text-secondary)' }}
          >
            Thẻ Combo
          </button>
          <button 
            className={`tab-button ${activeTab === 'staff' ? 'active' : ''}`}
            onClick={() => { setActiveTab('staff'); setPage(0); setSelectedUserForPanel(null); }}
            style={{ padding: '0.5rem 1rem', background: 'transparent', border: 'none', borderBottom: activeTab === 'staff' ? '2px solid var(--primary)' : '2px solid transparent', cursor: 'pointer', fontWeight: 500, color: activeTab === 'staff' ? 'var(--primary)' : 'var(--text-secondary)' }}
          >
            Nhân viên
          </button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '1.5rem', gap: '1rem' }}>
          <form style={{ flex: 1, maxWidth: '500px' }} onSubmit={e => { e.preventDefault(); setPage(0); setSearchQuery(searchTerm.trim()); }}>
            <label className="field compact-field">
              <span>Tìm kiếm (Tên đăng nhập, SĐT, CCCD)</span>
              <input
                type="text"
                placeholder="Nhập tên đăng nhập, SĐT, CCCD rồi Enter..."
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </label>
          </form>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <ListPagination
              page={page}
              canNext={users.length >= limit}
              onPrevious={() => setPage((current) => Math.max(0, current - 1))}
              onNext={() => setPage((current) => current + 1)}
            />
          </div>
        </div>

        <div className="table-card" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Tên Đăng Nhập</th>
                <th>Tên</th>
                {(activeTab === 'member' || activeTab === 'staff') && <th>SĐT</th>}
                {(activeTab === 'member' || activeTab === 'staff') && <th>CCCD</th>}
                {activeTab === 'member' && <th style={{ textAlign: 'right' }}>TK Chính</th>}
                {activeTab === 'member' && <th style={{ textAlign: 'right' }}>TK Phụ</th>}
                {activeTab === 'member' && <th>Nhóm</th>}
                {activeTab === 'staff' && <th>Nhóm</th>}
                {activeTab === 'member' && <th style={{ textAlign: 'center' }}>Trạng thái</th>}
                <th>Ghi chú</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: '2rem' }}>Đang tải...</td></tr>
              ) : isError ? (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-error)' }}>Lỗi: {(error as Error).message}</td></tr>
              ) : filteredUsers.length > 0 ? (
                filteredUsers.map((user) => (
                  <tr 
                    key={user.userId} 
                    onClick={() => setSelectedUserForPanel(user)}
                    style={{ 
                      cursor: 'pointer', 
                      backgroundColor: selectedUserForPanel?.userId === user.userId ? 'rgba(59, 130, 246, 0.05)' : undefined 
                    }}
                  >
                    <td style={{ fontWeight: 500, color: selectedUserForPanel?.userId === user.userId ? 'var(--primary)' : 'inherit' }}>
                      {user.userName}
                    </td>
                    <td>{`${user.lastName || ''} ${user.firstName || ''}`.trim()}</td>
                    {(activeTab === 'member' || activeTab === 'staff') && <td>{maskSensitiveInfo(user.phone)}</td>}
                    {(activeTab === 'member' || activeTab === 'staff') && <td>{maskSensitiveInfo(user.idNumber)}</td>}
                    {activeTab === 'member' && (
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: '1.1em', color: 'var(--primary)' }}>
                        {formatMoney(user.moneyMain)}
                      </td>
                    )}
                    {activeTab === 'member' && (
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: '1.1em', color: 'var(--text-secondary)' }}>
                        {formatMoney(user.moneySub)}
                      </td>
                    )}
                    {activeTab === 'member' && <td>{user.groupName || 'Member'}</td>}
                    {activeTab === 'staff' && <td>{user.groupName || 'Staff'}</td>}
                    {activeTab === 'member' && (
                      <td style={{ textAlign: 'center' }}>
                        <span style={{ padding: '0.25rem 0.5rem', borderRadius: '4px', fontSize: '0.85em', fontWeight: 'bold', backgroundColor: user.moneyRemain >= 0 ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)', color: user.moneyRemain >= 0 ? 'var(--primary)' : 'var(--text-error)' }}>
                          {user.moneyRemain >= 0 ? 'Active' : 'Locked'}
                        </span>
                      </td>
                    )}
                    <td>{user.note}</td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>Không tìm thấy dữ liệu</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Context Action Panel (Sidebar) */}
      {selectedUserForPanel && (
        <div style={{ 
          width: '320px', 
          borderLeft: '1px solid var(--border)', 
          backgroundColor: 'var(--background)', 
          padding: '2rem 1.5rem',
          display: 'flex', 
          flexDirection: 'column',
          overflowY: 'auto'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
            <div>
              <div style={{ fontSize: '0.85em', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>
                {activeTab === 'member' ? 'Hội viên' : activeTab === 'staff' ? 'Nhân viên' : 'Thẻ Combo'}
              </div>
              <h3 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0, color: 'var(--primary)' }}>
                {selectedUserForPanel.userName}
              </h3>
            </div>
            <button 
              type="button" 
              onClick={() => setSelectedUserForPanel(null)} 
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.5rem', color: 'var(--text-muted)' }}
              title="Đóng panel"
            >
              ×
            </button>
          </div>

          {activeTab === 'member' && (
            <div style={{ backgroundColor: 'var(--surface)', padding: '1rem', borderRadius: '8px', marginBottom: '1.5rem', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: '0.85em', color: 'var(--text-muted)' }}>Tổng số dư</div>
              <div style={{ fontSize: '1.5rem', fontFamily: 'monospace', fontWeight: 'bold', color: selectedUserForPanel.moneyRemain >= 0 ? 'var(--text-primary)' : 'var(--text-error)', marginTop: '0.25rem' }}>
                {formatMoney(selectedUserForPanel.moneyRemain)}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px dashed var(--border)' }}>
                <div>
                  <div style={{ fontSize: '0.75em', color: 'var(--text-muted)' }}>TK Chính</div>
                  <div style={{ fontFamily: 'monospace', fontWeight: 'bold', color: 'var(--primary)' }}>{formatMoney(selectedUserForPanel.moneyMain)}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.75em', color: 'var(--text-muted)' }}>TK Phụ</div>
                  <div style={{ fontFamily: 'monospace', fontWeight: 'bold', color: 'var(--text-secondary)' }}>{formatMoney(selectedUserForPanel.moneySub)}</div>
                </div>
              </div>
            </div>
          )}

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <h4 style={{ fontSize: '0.9em', color: 'var(--text-muted)', marginBottom: '0.5rem', marginTop: '0.5rem' }}>THAO TÁC CƠ BẢN</h4>
            <button type="button" className="secondary-button" style={{ justifyContent: 'flex-start' }}>✏️ Sửa thông tin</button>
            <button type="button" className="secondary-button" style={{ justifyContent: 'flex-start' }}>🔑 Cấp lại mật khẩu</button>
            {activeTab === 'member' && (
              <button type="button" className="secondary-button" style={{ justifyContent: 'flex-start', color: selectedUserForPanel.moneyRemain >= 0 ? 'var(--text-error)' : 'var(--primary)' }}>
                {selectedUserForPanel.moneyRemain >= 0 ? '🔒 Khóa tài khoản' : '🔓 Mở khóa tài khoản'}
              </button>
            )}
            
            {activeTab === 'member' && (
              <>
                <h4 style={{ fontSize: '0.9em', color: 'var(--text-muted)', marginBottom: '0.5rem', marginTop: '1rem' }}>GIAO DỊCH</h4>
                <button type="button" className="primary-button" style={{ justifyContent: 'flex-start' }} onClick={() => setIsDepositModalOpen(true)}>💰 Nạp tiền</button>
                <button type="button" className="secondary-button" style={{ justifyContent: 'flex-start' }} onClick={() => setIsGiveFreeModalOpen(true)}>🎁 Tặng giờ / Tặng tiền</button>
                <button type="button" className="secondary-button" style={{ justifyContent: 'flex-start' }} onClick={() => setIsCreditModalOpen(true)}>💸 Mượn giờ / Mượn tiền</button>
                <button type="button" className="secondary-button" style={{ justifyContent: 'flex-start' }} onClick={() => setIsTransferModalOpen(true)}>🤝 Chuyển tiền</button>
                <button type="button" className="secondary-button" style={{ justifyContent: 'flex-start' }} onClick={() => setIsPayDebtModalOpen(true)}>💳 Trả nợ</button>
                
                <h4 style={{ fontSize: '0.9em', color: 'var(--text-muted)', marginBottom: '0.5rem', marginTop: '1rem' }}>LỊCH SỬ</h4>
                <button type="button" className="secondary-button" style={{ justifyContent: 'flex-start' }} onClick={() => openHistory(selectedUserForPanel)}>
                  📜 Lịch sử nạp tiền
                </button>
                <button type="button" className="secondary-button" style={{ justifyContent: 'flex-start' }}>
                  🕒 Nhật ký sử dụng (Logs)
                </button>
              </>
            )}

            <button type="button" className="secondary-button" style={{ justifyContent: 'flex-start', color: 'var(--text-error)', marginTop: 'auto' }}>
              🗑️ Xóa {activeTab === 'member' ? 'hội viên' : activeTab === 'staff' ? 'nhân viên' : 'thẻ'}
            </button>
          </div>
        </div>
      )}

      <AutoGenerateMemberDialog
        open={isGenerateModalOpen}
        onClose={() => setIsGenerateModalOpen(false)}
      />

      {/* Modal Dọn Dẹp */}
      {isCleanModalOpen && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div className="page-card" style={{ width: '600px', backgroundColor: 'var(--surface)', maxHeight: '90vh', overflowY: 'auto' }}>
            <h3 style={{ marginBottom: '1.5rem', fontSize: '1.25rem', fontWeight: 600 }}>Dọn dẹp hội viên cũ</h3>
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', alignItems: 'flex-end' }}>
              <label className="field" style={{ flex: 1 }}>
                <span>Không hoạt động trong (tháng)</span>
                <input type="number" value={cleanMonths} onChange={e => setCleanMonths(Number(e.target.value))} min={1} />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', paddingBottom: '0.5rem', flex: 1 }}>
                <input type="checkbox" checked={cleanIgnoreBalance} onChange={e => setCleanIgnoreBalance(e.target.checked)} />
                <span style={{ fontSize: '0.85em' }}>Bỏ qua tài khoản còn số dư</span>
              </label>
              <button type="button" className="secondary-button" onClick={() => loadCleanCandidatesMutation.mutate()} disabled={loadCleanCandidatesMutation.isPending}>
                Lọc danh sách
              </button>
            </div>
            
            {cleanCandidates.length > 0 && (
              <div style={{ marginBottom: '1.5rem' }}>
                <div style={{ color: 'var(--text-error)', marginBottom: '0.5rem', fontWeight: 500 }}>
                  Tìm thấy {cleanCandidates.length} hội viên có thể xóa.
                </div>
                <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: '4px' }}>
                  <table className="data-table" style={{ margin: 0 }}>
                    <thead>
                      <tr><th>Username</th><th>Lần cuối HĐ</th></tr>
                    </thead>
                    <tbody>
                      {cleanCandidates.map((c, idx) => (
                        <tr key={idx}><td>{c.Name || c.userName}</td><td>{c.LastActive || 'N/A'}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
              <button type="button" className="secondary-button" onClick={() => { setIsCleanModalOpen(false); setCleanCandidates([]); }}>Hủy</button>
              <button type="button" className="primary-button" style={{ backgroundColor: 'var(--text-error)' }} onClick={() => deleteBatchMutation.mutate()} disabled={cleanCandidates.length === 0 || deleteBatchMutation.isPending}>
                {deleteBatchMutation.isPending ? 'Đang xóa...' : 'Xóa hàng loạt'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Lịch Sử Giao Dịch */}
      {isHistoryModalOpen && (
        <div className="modal-overlay" onClick={() => setIsHistoryModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ width: '600px', maxWidth: '90vw' }}>
            <div className="modal-header">
              <h3>Lịch sử Nạp Tiền: <span style={{ color: 'var(--primary)' }}>{selectedUser?.userName}</span></h3>
              <button type="button" className="close-button" onClick={() => setIsHistoryModalOpen(false)}>×</button>
            </div>
            
            <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Thời gian</th>
                    <th style={{ textAlign: 'right' }}>Số tiền nạp</th>
                    <th>Người thu</th>
                  </tr>
                </thead>
                <tbody>
                  {historyLoading ? (
                    <tr><td colSpan={3} style={{ textAlign: 'center', padding: '2rem' }}>Đang tải...</td></tr>
                  ) : (historyData?.items.length ?? 0) > 0 ? (
                    historyData!.items.map((log, idx) => (
                      <tr key={idx}>
                        <td>{[log.voucherDate, log.voucherTime].filter(Boolean).join(' ') || 'N/A'}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: 'var(--primary)' }}>+{formatMoney(log.amount || 0)}</td>
                        <td>{log.staffName || 'Admin'}</td>
                      </tr>
                    ))
                  ) : (
                    <tr><td colSpan={3} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>Chưa có lịch sử giao dịch</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Modal Trả Nợ */}
      {isPayDebtModalOpen && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div className="page-card" style={{ width: '400px', backgroundColor: 'var(--surface)' }}>
            <h3 style={{ marginBottom: '1.5rem', fontSize: '1.25rem', fontWeight: 600 }}>Trả nợ cho: <span style={{ color: 'var(--primary)' }}>{selectedUserForPanel?.userName}</span></h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
              <div style={{ padding: '1rem', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: '8px', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: '0.85em', color: 'var(--text-muted)' }}>Dư nợ hiện tại</div>
                <div style={{ fontSize: '1.25rem', fontFamily: 'monospace', fontWeight: 'bold', color: 'var(--text-error)', marginTop: '0.25rem' }}>
                  {formatMoney(Math.abs(Math.min(0, selectedUserForPanel?.moneyRemain || 0)))}
                </div>
              </div>
              <label className="field">
                <span>Số tiền thanh toán nợ (VNĐ)</span>
                <input type="number" value={debtAmount} onChange={e => setDebtAmount(Number(e.target.value))} min={0} step={1000} autoFocus />
              </label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
              <button type="button" className="secondary-button" onClick={() => { payDebtIntent.clearKey(); setIsPayDebtModalOpen(false); setDebtAmount(0); }}>Hủy</button>
              <button type="button" className="primary-button" onClick={() => payDebtMutation.mutate()} disabled={payDebtMutation.isPending || debtAmount <= 0}>
                {payDebtMutation.isPending ? 'Đang xử lý...' : 'Xác nhận trả nợ'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Modal Nạp Tiền (Deposit) */}
      {isDepositModalOpen && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div className="page-card" style={{ width: '450px', backgroundColor: 'var(--surface)' }}>
            <h3 style={{ marginBottom: '0.5rem', fontSize: '1.25rem', fontWeight: 600 }}>Nạp tiền cho: <span style={{ color: 'var(--primary)' }}>{selectedUserForPanel?.userName}</span></h3>
            <div style={{ marginBottom: '1.5rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
              Số dư hiện tại: <strong style={{ color: 'var(--text)' }}>{formatMoney(selectedUserForPanel?.moneyMain || 0)}</strong>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
              
              {/* 1. Số tiền nạp */}
              <label className="field">
                <span>Số tiền nạp (VNĐ)</span>
                <input type="number" value={depositAmount} onChange={e => setDepositAmount(Number(e.target.value))} min={0} step={1000} autoFocus style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--primary)' }} />
              </label>

              {/* Quick Amount Buttons */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.5rem' }}>
                {[10000, 20000, 30000, 50000, 100000].map(amt => (
                  <button key={amt} type="button" className="secondary-button" style={{ padding: '0.35rem', fontSize: '0.85rem', fontWeight: 600 }} onClick={() => setDepositAmount(amt)}>
                    {amt / 1000}K
                  </button>
                ))}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--background)', padding: '0.75rem', borderRadius: '4px' }}>
                <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Số dư sau nạp:</span>
                <strong style={{ fontSize: '1.25rem', color: 'var(--success)' }}>
                  {formatMoney((selectedUserForPanel?.moneyMain || 0) + depositAmount)}
                </strong>
              </div>

              <InlineAlert tone="info">
                Nạp tiền hiện chỉ ghi nhận tiền mặt. Chuyển khoản và QR sẽ được mở
                khi có mã thanh toán xác thực từ máy chủ.
              </InlineAlert>

              <label className="field">
                <span>Ghi chú / Số đơn hàng</span>
                <input type="text" value={depositNote} onChange={e => setDepositNote(e.target.value)} placeholder="Nhập ghi chú nạp tiền (tùy chọn)" />
              </label>

            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1rem' }}>
              <button type="button" className="secondary-button" onClick={() => { depositIntent.clearKey(); setIsDepositModalOpen(false); setDepositAmount(0); setDepositNote(''); }}>Hủy</button>
              <button type="button" className="primary-button" onClick={() => depositMutation.mutate()} disabled={depositMutation.isPending || depositAmount <= 0}>
                {depositMutation.isPending ? 'Đang xử lý...' : 'Xác nhận nạp'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Cho Mượn (Credit) */}
      {isCreditModalOpen && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div className="page-card" style={{ width: '400px', backgroundColor: 'var(--surface)' }}>
            <h3 style={{ marginBottom: '1.5rem', fontSize: '1.25rem', fontWeight: 600 }}>Cho mượn tiền: <span style={{ color: 'var(--primary)' }}>{selectedUserForPanel?.userName}</span></h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
              <label className="field">
                <span>Số tiền cho mượn (VNĐ)</span>
                <input type="number" value={creditAmount} onChange={e => setCreditAmount(Number(e.target.value))} min={0} step={1000} autoFocus />
              </label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
              <button type="button" className="secondary-button" onClick={() => { creditIntent.clearKey(); setIsCreditModalOpen(false); setCreditAmount(0); }}>Hủy</button>
              <button type="button" className="primary-button" onClick={() => creditMutation.mutate()} disabled={creditMutation.isPending || creditAmount <= 0}>
                {creditMutation.isPending ? 'Đang xử lý...' : 'Xác nhận'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Tặng Tiền (Give Free) */}
      {isGiveFreeModalOpen && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div className="page-card" style={{ width: '400px', backgroundColor: 'var(--surface)' }}>
            <h3 style={{ marginBottom: '1.5rem', fontSize: '1.25rem', fontWeight: 600 }}>Tặng tiền cho: <span style={{ color: 'var(--primary)' }}>{selectedUserForPanel?.userName}</span></h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
              <label className="field">
                <span>Số tiền tặng (VNĐ)</span>
                <input type="number" value={giveFreeAmount} onChange={e => setGiveFreeAmount(Number(e.target.value))} min={0} step={1000} autoFocus />
              </label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
              <button type="button" className="secondary-button" onClick={() => { giveFreeIntent.clearKey(); setIsGiveFreeModalOpen(false); setGiveFreeAmount(0); }}>Hủy</button>
              <button type="button" className="primary-button" onClick={() => giveFreeMutation.mutate()} disabled={giveFreeMutation.isPending || giveFreeAmount <= 0}>
                {giveFreeMutation.isPending ? 'Đang xử lý...' : 'Xác nhận tặng'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Chuyển Tiền (Transfer) */}
      {isTransferModalOpen && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div className="page-card" style={{ width: '400px', backgroundColor: 'var(--surface)' }}>
            <h3 style={{ marginBottom: '1.5rem', fontSize: '1.25rem', fontWeight: 600 }}>Chuyển tiền từ: <span style={{ color: 'var(--primary)' }}>{selectedUserForPanel?.userName}</span></h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
              <label className="field">
                <span>Số tiền chuyển (VNĐ)</span>
                <input type="number" value={transferAmount} onChange={e => setTransferAmount(Number(e.target.value))} min={0} step={1000} autoFocus />
              </label>
              <label className="field">
                <span>ID Người nhận (User ID)</span>
                <input type="number" value={transferToUserId} onChange={e => setTransferToUserId(Number(e.target.value))} min={1} />
              </label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
              <button type="button" className="secondary-button" onClick={() => { transferIntent.clearKey(); setIsTransferModalOpen(false); setTransferAmount(0); setTransferToUserId(0); }}>Hủy</button>
              <button type="button" className="primary-button" onClick={() => transferMutation.mutate()} disabled={transferMutation.isPending || transferAmount <= 0 || transferToUserId <= 0}>
                {transferMutation.isPending ? 'Đang xử lý...' : 'Xác nhận chuyển'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
