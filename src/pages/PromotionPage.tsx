import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect, useMemo } from 'react';
import {
  getPromotionMember,
  savePromotionMember,
  getPromotionTime,
  savePromotionTime,
  getPromotionDiscount,
  savePromotionDiscount,
  type MemberPolicy,
  type PromoFreeTier,
  type PromoPercentTier,
  type PromoTimeRow,
  type PromoDiscountRow
} from '../api/promotion';
import { getUserGroups } from '../api/user-groups';
import { getMachineGroups } from '../api/machine-groups';
import { supportsUserGroupPricingAndPromotion } from '../features/user-groups/userGroupModel';
import { pushToast } from '../store/toast';
import { Select } from '../design-system/components';

export function PromotionPage() {
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<'member' | 'time' | 'discount'>('member');

  const { data: userGroups } = useQuery({
    queryKey: ['user-groups'],
    queryFn: getUserGroups,
  });

  const { data: machineGroups } = useQuery({
    queryKey: ['machine-groups'],
    queryFn: getMachineGroups,
  });

  const filteredUserGroups = useMemo(() => {
    return userGroups?.filter(supportsUserGroupPricingAndPromotion) || [];
  }, [userGroups]);

  useEffect(() => {
    if (filteredUserGroups.length > 0 && !selectedGroupId) {
      setSelectedGroupId(filteredUserGroups[0].id);
    }
  }, [filteredUserGroups, selectedGroupId]);

  const selectedGroup = filteredUserGroups.find(g => g.id === selectedGroupId);

  return (
    <section className="page-card" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 48px)' }}>
      <div className="page-header" style={{ padding: '2rem 2rem 0' }}>
        <div>
          <p className="eyebrow">Phase 3 · Task 2.20</p>
          <h2 className="section-title">Khuyến mãi hệ thống</h2>
        </div>
      </div>

      <div style={{ padding: '0 2rem 1rem' }}>
        <p className="page-description">Quản lý khuyến mãi nạp tiền, khung giờ vàng và chiết khấu cho từng nhóm người dùng.</p>
        
        <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <label style={{ fontWeight: 500 }}>Chọn nhóm người dùng:</label>
          <Select 
            value={selectedGroupId || ''} 
            onChange={e => setSelectedGroupId(Number(e.target.value))}
            style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--border)', minWidth: '200px' }}
          >
            {filteredUserGroups.map(g => (
              <option key={g.id} value={g.id}>{g.name} ({g.type})</option>
            ))}
          </Select>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '1rem', borderBottom: '1px solid var(--border)', padding: '0 2rem' }}>
        <button 
          className={`tab-button ${activeTab === 'member' ? 'active' : ''}`}
          onClick={() => setActiveTab('member')}
          style={{ padding: '1rem 1.5rem', background: 'transparent', border: 'none', borderBottom: activeTab === 'member' ? '2px solid var(--primary)' : '2px solid transparent', cursor: 'pointer', fontWeight: 500, color: activeTab === 'member' ? 'var(--primary)' : 'var(--text-secondary)' }}
        >
          Khuyến mãi Nạp tiền
        </button>
        <button 
          className={`tab-button ${activeTab === 'time' ? 'active' : ''}`}
          onClick={() => setActiveTab('time')}
          style={{ padding: '1rem 1.5rem', background: 'transparent', border: 'none', borderBottom: activeTab === 'time' ? '2px solid var(--primary)' : '2px solid transparent', cursor: 'pointer', fontWeight: 500, color: activeTab === 'time' ? 'var(--primary)' : 'var(--text-secondary)' }}
        >
          Khung giờ vàng
        </button>
        <button 
          className={`tab-button ${activeTab === 'discount' ? 'active' : ''}`}
          onClick={() => setActiveTab('discount')}
          style={{ padding: '1rem 1.5rem', background: 'transparent', border: 'none', borderBottom: activeTab === 'discount' ? '2px solid var(--primary)' : '2px solid transparent', cursor: 'pointer', fontWeight: 500, color: activeTab === 'discount' ? 'var(--primary)' : 'var(--text-secondary)' }}
        >
          Chiết khấu theo mức/kỳ hạn
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '2rem' }}>
        {!selectedGroup ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>Vui lòng chọn một nhóm người dùng</div>
        ) : (
          <>
            {activeTab === 'member' && <PromotionMemberTab priceId={selectedGroupId!} />}
            {activeTab === 'time' && <PromotionTimeTab priceId={selectedGroupId!} machineGroups={machineGroups || []} />}
            {activeTab === 'discount' && <PromotionDiscountTab priceId={selectedGroupId!} machineGroups={machineGroups || []} />}
          </>
        )}
      </div>
    </section>
  );
}

// --------------------------------------------------------------------------------
// MEMBER TAB
// --------------------------------------------------------------------------------
function PromotionMemberTab({ priceId }: { priceId: number }) {
  const queryClient = useQueryClient();
  const [apply, setApply] = useState(true);
  const [policy, setPolicy] = useState<MemberPolicy>('none');
  const [beginDate, setBeginDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [firstDeposit, setFirstDeposit] = useState<{ percent: number; minAmount: number }>({ percent: 0, minAmount: 0 });
  
  const [accumulate, setAccumulate] = useState({ charge: 0, bonus: 0 });
  const [freeTiers, setFreeTiers] = useState<PromoFreeTier[]>([]);
  const [percentTiers, setPercentTiers] = useState<PromoPercentTier[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ['promotions', 'member', priceId],
    queryFn: () => getPromotionMember(priceId),
  });

  useEffect(() => {
    if (data) {
      if (data.accumulate) {
        setPolicy('accumulate');
        setAccumulate({ charge: data.accumulate.charge, bonus: data.accumulate.bonus });
        setBeginDate(data.accumulate.beginDate);
        setEndDate(data.accumulate.endDate);
      } else if (data.freeTiers && data.freeTiers.length > 0) {
        setPolicy('free');
        setFreeTiers(data.freeTiers);
      } else if (data.percentTiers && data.percentTiers.length > 0) {
        setPolicy('percent');
        setPercentTiers(data.percentTiers);
      } else {
        setPolicy('none');
      }

      if (data.firstDeposit) {
        setFirstDeposit({ percent: data.firstDeposit.percent, minAmount: data.firstDeposit.minAmount });
      } else {
        setFirstDeposit({ percent: 0, minAmount: 0 });
      }
    }
  }, [data]);

  const mutation = useMutation({
    mutationFn: () => savePromotionMember({
      priceId,
      apply,
      policy,
      beginDate,
      endDate,
      charge: accumulate.charge,
      bonus: accumulate.bonus,
      freeTiers,
      percentTiers,
      firstDeposit
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['promotions'] });
      pushToast('Lưu khuyến mãi thành công', 'success');
    },
    onError: (err: any) => pushToast(err.message || 'Lỗi khi lưu', 'error'),
  });

  if (isLoading) return <div>Đang tải...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '800px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <input type="checkbox" checked={apply} onChange={e => setApply(e.target.checked)} />
        <label>Áp dụng khuyến mãi nạp tiền</label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', opacity: apply ? 1 : 0.5, pointerEvents: apply ? 'auto' : 'none' }}>
        <label className="field">
          <span>Từ ngày</span>
          <input type="date" value={beginDate} onChange={e => setBeginDate(e.target.value)} />
        </label>
        <label className="field">
          <span>Đến ngày</span>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
        </label>
      </div>

      <div style={{ opacity: apply ? 1 : 0.5, pointerEvents: apply ? 'auto' : 'none' }}>
        <span style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Chính sách khuyến mãi</span>
        <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--border)' }}>
          <button 
            type="button"
            className={`tab-button ${policy === 'none' ? 'active' : ''}`}
            onClick={() => setPolicy('none')}
            style={{ padding: '0.75rem 1rem', background: 'transparent', border: 'none', borderBottom: policy === 'none' ? '2px solid var(--primary)' : '2px solid transparent', cursor: 'pointer', fontWeight: 500, color: policy === 'none' ? 'var(--primary)' : 'var(--text-secondary)' }}
          >
            Không có
          </button>
          <button 
            type="button"
            className={`tab-button ${policy === 'accumulate' ? 'active' : ''}`}
            onClick={() => setPolicy('accumulate')}
            style={{ padding: '0.75rem 1rem', background: 'transparent', border: 'none', borderBottom: policy === 'accumulate' ? '2px solid var(--primary)' : '2px solid transparent', cursor: 'pointer', fontWeight: 500, color: policy === 'accumulate' ? 'var(--primary)' : 'var(--text-secondary)' }}
          >
            Khuyến mãi tích lũy
          </button>
          <button 
            type="button"
            className={`tab-button ${policy === 'free' ? 'active' : ''}`}
            onClick={() => setPolicy('free')}
            style={{ padding: '0.75rem 1rem', background: 'transparent', border: 'none', borderBottom: policy === 'free' ? '2px solid var(--primary)' : '2px solid transparent', cursor: 'pointer', fontWeight: 500, color: policy === 'free' ? 'var(--primary)' : 'var(--text-secondary)' }}
          >
            Tặng tiền theo mức
          </button>
          <button 
            type="button"
            className={`tab-button ${policy === 'percent' ? 'active' : ''}`}
            onClick={() => setPolicy('percent')}
            style={{ padding: '0.75rem 1rem', background: 'transparent', border: 'none', borderBottom: policy === 'percent' ? '2px solid var(--primary)' : '2px solid transparent', cursor: 'pointer', fontWeight: 500, color: policy === 'percent' ? 'var(--primary)' : 'var(--text-secondary)' }}
          >
            Tặng % theo mức
          </button>
        </div>
      </div>

      {policy === 'accumulate' && apply && (
        <div style={{ padding: '1rem', border: '1px solid var(--border)', borderRadius: '8px', display: 'flex', gap: '1rem' }}>
          <label className="field">
            <span>Mức nạp (VNĐ)</span>
            <input type="number" value={accumulate.charge} onChange={e => setAccumulate({...accumulate, charge: Number(e.target.value)})} />
          </label>
          <label className="field">
            <span>Được tặng (VNĐ)</span>
            <input type="number" value={accumulate.bonus} onChange={e => setAccumulate({...accumulate, bonus: Number(e.target.value)})} />
          </label>
        </div>
      )}

      {policy === 'free' && apply && (
        <div style={{ padding: '1rem', border: '1px solid var(--border)', borderRadius: '8px' }}>
          <h4>Các mốc tặng tiền</h4>
          {freeTiers.map((t, idx) => (
            <div key={idx} style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
              <input type="number" placeholder="Mức nạp" value={t.charge} onChange={e => { const newTiers = [...freeTiers]; newTiers[idx].charge = Number(e.target.value); setFreeTiers(newTiers); }} />
              <input type="number" placeholder="Tặng" value={t.free} onChange={e => { const newTiers = [...freeTiers]; newTiers[idx].free = Number(e.target.value); setFreeTiers(newTiers); }} />
              <button type="button" onClick={() => setFreeTiers(freeTiers.filter((_, i) => i !== idx))}>X</button>
            </div>
          ))}
          <button type="button" className="secondary-button" style={{ marginTop: '1rem' }} onClick={() => setFreeTiers([...freeTiers, {charge: 0, free: 0}])}>+ Thêm mốc</button>
        </div>
      )}

      {policy === 'percent' && apply && (
        <div style={{ padding: '1rem', border: '1px solid var(--border)', borderRadius: '8px' }}>
          <h4>Các mốc tặng %</h4>
          {percentTiers.map((t, idx) => (
            <div key={idx} style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
              <input type="number" placeholder="Mức nạp" value={t.charge} onChange={e => { const newTiers = [...percentTiers]; newTiers[idx].charge = Number(e.target.value); setPercentTiers(newTiers); }} />
              <input type="number" placeholder="% Tặng" value={t.percent} onChange={e => { const newTiers = [...percentTiers]; newTiers[idx].percent = Number(e.target.value); setPercentTiers(newTiers); }} />
              <button type="button" onClick={() => setPercentTiers(percentTiers.filter((_, i) => i !== idx))}>X</button>
            </div>
          ))}
          <button type="button" className="secondary-button" style={{ marginTop: '1rem' }} onClick={() => setPercentTiers([...percentTiers, {charge: 0, percent: 0}])}>+ Thêm mốc</button>
        </div>
      )}

      <div style={{ padding: '1rem', border: '1px solid var(--border)', borderRadius: '8px', backgroundColor: 'rgba(59, 130, 246, 0.05)' }}>
        <h4 style={{ color: 'var(--primary)' }}>Khuyến mãi Nạp lần đầu (Độc lập)</h4>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1rem' }}>
          <label className="field">
            <span>Tặng (%)</span>
            <input type="number" value={firstDeposit.percent} onChange={e => setFirstDeposit({...firstDeposit, percent: Number(e.target.value)})} />
          </label>
          <label className="field">
            <span>Mức nạp tối thiểu (VNĐ)</span>
            <input type="number" value={firstDeposit.minAmount} onChange={e => setFirstDeposit({...firstDeposit, minAmount: Number(e.target.value)})} />
          </label>
        </div>
      </div>

      <div>
        <button type="button" className="primary-button" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
          Lưu cấu hình nạp tiền
        </button>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------------
// TIME TAB
// --------------------------------------------------------------------------------
function PromotionTimeTab({ priceId, machineGroups }: { priceId: number, machineGroups: any[] }) {
  const queryClient = useQueryClient();
  const [beginDate, setBeginDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [rows, setRows] = useState<Omit<PromoTimeRow, 'beginDate' | 'endDate'>[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ['promotions', 'time', priceId],
    queryFn: () => getPromotionTime(priceId),
  });

  useEffect(() => {
    if (data) {
      if (data.rows && data.rows.length > 0) {
        setBeginDate(data.rows[0].beginDate || '');
        setEndDate(data.rows[0].endDate || '');
        setRows(data.rows);
      } else {
        setRows([]);
        setBeginDate('');
        setEndDate('');
      }
    }
  }, [data]);

  const mutation = useMutation({
    mutationFn: () => savePromotionTime({ priceId, beginDate, endDate, rows }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['promotions'] });
      pushToast('Lưu khung giờ vàng thành công', 'success');
    },
    onError: (err: any) => pushToast(err.message || 'Lỗi khi lưu', 'error'),
  });

  if (isLoading) return <div>Đang tải...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '1000px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <label className="field">
          <span>Từ ngày</span>
          <input type="date" value={beginDate} onChange={e => setBeginDate(e.target.value)} />
        </label>
        <label className="field">
          <span>Đến ngày</span>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
        </label>
      </div>

      <div style={{ padding: '1rem', border: '1px solid var(--border)', borderRadius: '8px' }}>
        <h4>Danh sách khung giờ vàng</h4>
        <table className="data-table" style={{ marginTop: '1rem' }}>
          <thead>
            <tr>
              <th>Nhóm máy</th>
              <th>Giờ bắt đầu</th>
              <th>Giờ kết thúc</th>
              <th>Giá (VNĐ/h)</th>
              <th>Ngày trong tuần (Mask)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr key={idx}>
                <td>
                  <Select value={r.machineGroupId} onChange={e => { const nr = [...rows]; nr[idx].machineGroupId = Number(e.target.value); setRows(nr); }}>
                    <option value={0}>Chọn nhóm máy</option>
                    {machineGroups.map(mg => <option key={mg.id} value={mg.id}>{mg.name}</option>)}
                  </Select>
                </td>
                <td><input type="number" placeholder="HHMMSS" value={r.beginTime} onChange={e => { const nr = [...rows]; nr[idx].beginTime = e.target.value; setRows(nr); }} /></td>
                <td><input type="number" placeholder="HHMMSS" value={r.endTime} onChange={e => { const nr = [...rows]; nr[idx].endTime = e.target.value; setRows(nr); }} /></td>
                <td><input type="number" value={r.price} onChange={e => { const nr = [...rows]; nr[idx].price = Number(e.target.value); setRows(nr); }} /></td>
                <td><input type="number" value={r.dayOfWeekMask} min={0} max={127} onChange={e => { const nr = [...rows]; nr[idx].dayOfWeekMask = Number(e.target.value); setRows(nr); }} title="VD: 127 = Cả tuần, 62 = T2-T6" /></td>
                <td><button type="button" onClick={() => setRows(rows.filter((_, i) => i !== idx))}>Xóa</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="secondary-button" style={{ marginTop: '1rem' }} onClick={() => setRows([...rows, { machineGroupId: 0, beginTime: '000000', endTime: '235959', price: 0, dayOfWeekMask: 127 }])}>+ Thêm khung giờ</button>
      </div>

      <div>
        <button type="button" className="primary-button" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
          Lưu khung giờ vàng
        </button>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------------
// DISCOUNT TAB
// --------------------------------------------------------------------------------
function PromotionDiscountTab({ priceId, machineGroups }: { priceId: number, machineGroups: any[] }) {
  const queryClient = useQueryClient();
  const [beginDate, setBeginDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [rows, setRows] = useState<Omit<PromoDiscountRow, 'beginDate' | 'endDate'>[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ['promotions', 'discount', priceId],
    queryFn: () => getPromotionDiscount(priceId),
  });

  useEffect(() => {
    if (data) {
      if (data.rows && data.rows.length > 0) {
        setBeginDate(data.rows[0].beginDate || '');
        setEndDate(data.rows[0].endDate || '');
        setRows(data.rows);
      } else {
        setRows([]);
        setBeginDate('');
        setEndDate('');
      }
    }
  }, [data]);

  const mutation = useMutation({
    mutationFn: () => savePromotionDiscount({ priceId, beginDate, endDate, rows }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['promotions'] });
      pushToast('Lưu chiết khấu thành công', 'success');
    },
    onError: (err: any) => pushToast(err.message || 'Lỗi khi lưu', 'error'),
  });

  if (isLoading) return <div>Đang tải...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '1000px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <label className="field">
          <span>Từ ngày</span>
          <input type="date" value={beginDate} onChange={e => setBeginDate(e.target.value)} />
        </label>
        <label className="field">
          <span>Đến ngày</span>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
        </label>
      </div>

      <div style={{ padding: '1rem', border: '1px solid var(--border)', borderRadius: '8px' }}>
        <h4>Danh sách chiết khấu theo mức/kỳ hạn</h4>
        <table className="data-table" style={{ marginTop: '1rem' }}>
          <thead>
            <tr>
              <th>Nhóm máy</th>
              <th>Mức/Kỳ hạn (term)</th>
              <th>Loại (0=Kỳ hạn, 1=Mức nạp)</th>
              <th>Giá (VNĐ/h)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr key={idx}>
                <td>
                  <Select value={r.machineGroupId} onChange={e => { const nr = [...rows]; nr[idx].machineGroupId = Number(e.target.value); setRows(nr); }}>
                    <option value={0}>Chọn nhóm máy</option>
                    {machineGroups.map(mg => <option key={mg.id} value={mg.id}>{mg.name}</option>)}
                  </Select>
                </td>
                <td><input type="number" value={r.term} onChange={e => { const nr = [...rows]; nr[idx].term = Number(e.target.value); setRows(nr); }} /></td>
                <td>
                  <Select value={r.promotionOrder} onChange={e => { const nr = [...rows]; nr[idx].promotionOrder = Number(e.target.value); setRows(nr); }}>
                    <option value={0}>Theo giờ (Kỳ hạn)</option>
                    <option value={1}>Theo mức nạp</option>
                  </Select>
                </td>
                <td><input type="number" value={r.price} onChange={e => { const nr = [...rows]; nr[idx].price = Number(e.target.value); setRows(nr); }} /></td>
                <td><button type="button" onClick={() => setRows(rows.filter((_, i) => i !== idx))}>Xóa</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="secondary-button" style={{ marginTop: '1rem' }} onClick={() => setRows([...rows, { machineGroupId: 0, term: 0, promotionOrder: 0, price: 0 }])}>+ Thêm chiết khấu</button>
      </div>

      <div>
        <button type="button" className="primary-button" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
          Lưu chiết khấu
        </button>
      </div>
    </div>
  );
}
