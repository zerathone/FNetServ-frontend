import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useMemo, useEffect } from 'react';
import { staffRightsApi } from '../api/staffRights';
import { getUsers } from '../api/users';
import { Button, ListPagination } from '../design-system/components';
import { pushToast as showToast } from '../store/toast';

const STAFF_PAGE_SIZE = 50

export function StaffRightsPage() {
  const queryClient = useQueryClient();
  const [selectedStaffId, setSelectedStaffId] = useState<number | null>(null);
  
  const [localCheckedCodes, setLocalCheckedCodes] = useState<Set<string>>(new Set());
  const [expandedCodes, setExpandedCodes] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [staffPage, setStaffPage] = useState(0);

  // Lấy danh sách staff
  const { data: staffResponse, isLoading: isStaffLoading } = useQuery({
    queryKey: ['users', 'staff', staffPage, searchTerm],
    queryFn: () => getUsers('staff', STAFF_PAGE_SIZE, staffPage * STAFF_PAGE_SIZE, searchTerm.trim() || undefined),
  });
  const staffData = staffResponse?.items ?? [];

  // Lấy quyền của staff đã chọn
  const { data: rightsData, isLoading: isRightsLoading } = useQuery({
    queryKey: ['staffRights', selectedStaffId],
    queryFn: async () => {
      if (!selectedStaffId) return null;
      const response = await staffRightsApi.getRights(selectedStaffId);
      const functions = response.functions || [];
      return { allFunctions: functions };
    },
    enabled: !!selectedStaffId,
  });

  // Xây dựng cây phân quyền
  const { tree, nodeMap } = useMemo(() => {
    if (!rightsData?.allFunctions) return { tree: [], nodeMap: new Map() };
    const functions = rightsData.allFunctions;
    const tree: any[] = [];
    const nodeMap = new Map<string, any>();
    
    functions.forEach((f: any) => {
      nodeMap.set(String(f.code), { ...f, code: String(f.code), parentFunction: String(f.parentFunction), children: [] });
    });

    functions.forEach((f: any) => {
      const node = nodeMap.get(String(f.code));
      const parent = nodeMap.get(node.parentFunction);
      if (parent && String(node.parentFunction) !== String(node.code)) {
        parent.children.push(node);
      } else {
        tree.push(node);
      }
    });

    const sortNodes = (nodes: any[]) => {
      nodes.sort((a: any, b: any) => a.order - b.order);
      nodes.forEach((n: any) => sortNodes(n.children));
    };
    sortNodes(tree);

    return { tree, nodeMap };
  }, [rightsData]);

  // Khởi tạo state (checked và expanded) khi load xong quyền của một nhân viên
  useEffect(() => {
    if (rightsData?.allFunctions && tree.length > 0) {
      const functions = rightsData.allFunctions;
      const granted = functions.filter((f: any) => f.granted).map((f: any) => String(f.code));
      setLocalCheckedCodes(new Set(granted));
      
      // Bung tất cả các node gốc (root nodes của cây, thường là node "Tất cả")
      const rootCodes = tree.map((n: any) => n.code);
      setExpandedCodes(new Set(rootCodes));
    } else {
      setLocalCheckedCodes(new Set());
      setExpandedCodes(new Set());
    }
  }, [rightsData, tree, selectedStaffId]);

  const updateMutation = useMutation({
    mutationFn: ({ staffId, codes }: { staffId: number, codes: string[] }) => staffRightsApi.updateRights(staffId, codes),
    onSuccess: () => {
      showToast('Cập nhật phân quyền thành công', 'success');
      queryClient.invalidateQueries({ queryKey: ['staffRights', selectedStaffId] });
    },
    onError: (err: any) => {
      showToast(`Lỗi: ${err.message}`, 'error');
    }
  });

  const handleToggleRight = (code: string) => {
    const node = nodeMap.get(code);
    if (!node) return;

    const newSet = new Set(localCheckedCodes);
    const isCurrentlyChecked = newSet.has(code);

    // 1. Toggle node và toàn bộ node con
    const setNodeAndChildren = (n: any, check: boolean) => {
      if (check) newSet.add(n.code);
      else newSet.delete(n.code);
      n.children?.forEach((c: any) => setNodeAndChildren(c, check));
    };
    
    setNodeAndChildren(node, !isCurrentlyChecked);

    // 2. Cập nhật trạng thái node cha từ dưới lên
    let parent = nodeMap.get(node.parentFunction);
    while (parent) {
      const allChildrenChecked = parent.children.length > 0 && parent.children.every((c: any) => newSet.has(c.code));
      if (allChildrenChecked) {
        newSet.add(parent.code);
      } else {
        newSet.delete(parent.code);
      }
      parent = nodeMap.get(parent.parentFunction);
    }

    setLocalCheckedCodes(newSet);
  };

  const toggleExpand = (code: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newSet = new Set(expandedCodes);
    if (newSet.has(code)) newSet.delete(code);
    else newSet.add(code);
    setExpandedCodes(newSet);
  };

  const isIndeterminate = (node: any) => {
    if (!node.children || node.children.length === 0) return false;
    let checkedCount = 0;
    node.children.forEach((c: any) => {
      if (localCheckedCodes.has(c.code)) checkedCount++;
    });
    return checkedCount > 0 && checkedCount < node.children.length;
  };

  const handleSave = () => {
    if (!selectedStaffId) return;
    updateMutation.mutate({ 
      staffId: selectedStaffId, 
      codes: Array.from(localCheckedCodes)
    });
  };

  const renderTreeRows = () => {
    const rows: React.ReactNode[] = [];
    
    const traverse = (nodes: any[], depth: number) => {
      nodes.forEach(node => {
        const isChecked = localCheckedCodes.has(node.code);
        const indet = isIndeterminate(node);
        const hasChildren = node.children && node.children.length > 0;
        const isExpanded = expandedCodes.has(node.code);

        rows.push(
          <tr key={node.code} onClick={() => handleToggleRight(node.code)} style={{ cursor: 'pointer' }}>
            <td style={{ paddingLeft: `${depth * 2 + 0.5}rem` }}>
               <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  {hasChildren ? (
                    <span 
                      onClick={(e) => toggleExpand(node.code, e)} 
                      style={{ cursor: 'pointer', width: '20px', display: 'inline-block', textAlign: 'center', fontSize: '0.85em', color: 'var(--text-muted)' }}
                    >
                       {isExpanded ? '▼' : '▶'}
                    </span>
                  ) : (
                    <span style={{ width: '20px', display: 'inline-block' }}></span>
                  )}
                  <input 
                    type="checkbox"
                    checked={isChecked}
                    ref={el => { if (el) el.indeterminate = indet; }}
                    onChange={() => {}} // handled by tr click
                    style={{ margin: 0 }}
                  />
               </div>
            </td>
            <td style={{ fontFamily: 'monospace', color: 'var(--text-muted)' }}>{node.code}</td>
            <td style={{ fontWeight: isChecked || indet ? 500 : 400 }}>{node.name}</td>
          </tr>
        );

        if (isExpanded && hasChildren) {
          traverse(node.children, depth + 1);
        }
      });
    };

    traverse(tree, 0);
    return rows;
  };

  return (
    <section className="page-card" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 48px)' }}>
      <div className="page-header">
        <div>
          <p className="eyebrow">Phase 3 · Task 4</p>
          <h2 className="section-title">Phân Quyền Nhân Viên</h2>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Button
            type="button"
            variant="primary"
            onClick={handleSave}
            loading={updateMutation.isPending}
            disabled={!selectedStaffId}
          >
            {updateMutation.isPending ? 'Đang lưu...' : 'Lưu Phân Quyền'}
          </Button>
        </div>
      </div>

      <p className="page-description">Chọn nhân viên từ danh sách và tích các quyền hạn tương ứng.</p>

      <div style={{ display: 'flex', flex: 1, minHeight: 0, gap: '2rem', marginTop: '1.5rem' }}>
        
        {/* Cột 1: Danh sách nhân viên */}
        <div style={{ display: 'flex', flexDirection: 'column', width: '300px' }}>
          <label className="field compact-field" style={{ marginBottom: '1rem' }}>
            <span>Tìm kiếm tài khoản / tên</span>
            <input 
              type="text" 
              placeholder="Nhập tên đăng nhập..." 
              value={searchTerm} 
              onChange={e => {
                setSearchTerm(e.target.value);
                setStaffPage(0);
                setSelectedStaffId(null);
              }}
            />
          </label>
          <ListPagination
            page={staffPage}
            canNext={staffData.length >= STAFF_PAGE_SIZE}
            onPrevious={() => {
              setStaffPage((page) => Math.max(0, page - 1));
              setSelectedStaffId(null);
            }}
            onNext={() => {
              setStaffPage((page) => page + 1);
              setSelectedStaffId(null);
            }}
          />
          <div className="table-card" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            <table className="data-table">
            <thead>
              <tr>
                <th>Chọn Nhân Viên</th>
              </tr>
            </thead>
            <tbody>
              {isStaffLoading ? (
                <tr><td style={{ padding: '1rem', textAlign: 'center' }}>Đang tải...</td></tr>
              ) : staffData.length > 0 ? (
                staffData.map((staff: any) => (
                  <tr 
                    key={staff.userId} 
                    style={{ 
                      cursor: 'pointer', 
                      backgroundColor: selectedStaffId === staff.userId ? 'var(--bg-active)' : 'transparent',
                      borderLeft: selectedStaffId === staff.userId ? '3px solid var(--primary)' : '3px solid transparent'
                    }}
                    onClick={() => setSelectedStaffId(staff.userId)}
                  >
                    <td>
                      <div style={{ fontWeight: 500, color: selectedStaffId === staff.userId ? 'var(--primary)' : 'inherit' }}>
                        {staff.userName}
                      </div>
                      <div style={{ fontSize: '0.85em', color: 'var(--text-muted)' }}>
                        Nhóm: {staff.groupName || 'Staff'}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr><td style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)' }}>Không có nhân viên</td></tr>
              )}
            </tbody>
          </table>
          </div>
        </div>

        {/* Cột 2: Bảng phân quyền */}
        <div className="table-card" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {!selectedStaffId ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              Vui lòng chọn một nhân viên ở danh sách bên trái
            </div>
          ) : isRightsLoading ? (
            <div style={{ padding: '3rem', textAlign: 'center' }}>Đang tải quyền hạn...</div>
          ) : rightsData ? (
            <div>
              <div style={{ padding: '1rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontWeight: 600 }}>Cấp quyền cho: <span style={{ color: 'var(--primary)' }}>{staffData.find((s:any) => s.userId === selectedStaffId)?.userName}</span></div>
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: '100px' }}>Chọn</th>
                    <th style={{ width: '100px' }}>Mã Quyền</th>
                    <th>Tên Quyền Hạn</th>
                  </tr>
                </thead>
                <tbody>
                  {renderTreeRows()}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-error)' }}>Lỗi khi tải dữ liệu</div>
          )}
        </div>

      </div>
    </section>
  );
}
