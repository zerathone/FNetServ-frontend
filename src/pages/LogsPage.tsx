import { useCallback, useState, useEffect } from 'react';

import { 
  getSystemLogs, 
  getServerLogs, 
  getWebHistoryLogs, 
  getVoucherLogs,
  truncateSystemLogs,
  truncateServerLogs,
  truncateWebHistoryLogs,
  truncateVoucherLogs
} from '../api/logs';
import { pushToast } from '../store/toast';
import type { SystemLog, ServerLog, WebHistoryLog, VoucherLog } from '../api/logs';

type Tab = 'system' | 'server' | 'webhistory' | 'voucher';

export default function LogsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('system');
  
  const [systemLogs, setSystemLogs] = useState<SystemLog[]>([]);
  const [serverLogs, setServerLogs] = useState<ServerLog[]>([]);
  const [webHistoryLogs, setWebHistoryLogs] = useState<WebHistoryLog[]>([]);
  const [voucherLogs, setVoucherLogs] = useState<VoucherLog[]>([]);
  
  const [loading, setLoading] = useState(false);

  const fetchLogs = useCallback(async () => {
    const today = new Date().toISOString().split('T')[0];
    setLoading(true);
    try {
      if (activeTab === 'system') {
        const res = await getSystemLogs(today, today);
        setSystemLogs(res.items || []);
      } else if (activeTab === 'server') {
        const res = await getServerLogs(today, today);
        setServerLogs(res || []);
      } else if (activeTab === 'webhistory') {
        const res = await getWebHistoryLogs(today, today);
        setWebHistoryLogs(res.items || []);
      } else if (activeTab === 'voucher') {
        const res = await getVoucherLogs(today, today);
        setVoucherLogs(res.items || []);
      }
    } catch (error: any) {
      pushToast(error.message || 'Failed to fetch logs', 'error');
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);

  const handleTruncate = async () => {
    if (!window.confirm('Are you sure you want to truncate these logs?')) return;
    
    try {
      if (activeTab === 'system') await truncateSystemLogs();
      else if (activeTab === 'server') await truncateServerLogs();
      else if (activeTab === 'webhistory') await truncateWebHistoryLogs();
      else if (activeTab === 'voucher') await truncateVoucherLogs();
      
      pushToast('Logs truncated successfully', 'success');
      fetchLogs(); // Refresh
    } catch (error: any) {
      pushToast(error.message || 'Failed to truncate logs', 'error');
    }
  };

  const renderTable = () => {
    if (loading) return <div>Loading logs...</div>;

    switch (activeTab) {
      case 'system':
        return (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '1rem' }}>
            <thead>
              <tr style={{ backgroundColor: '#f3f4f6', textAlign: 'left' }}>
                <th style={{ padding: '0.5rem', border: '1px solid #e5e7eb' }}>ID</th>
                <th style={{ padding: '0.5rem', border: '1px solid #e5e7eb' }}>Machine</th>
                <th style={{ padding: '0.5rem', border: '1px solid #e5e7eb' }}>User</th>
                <th style={{ padding: '0.5rem', border: '1px solid #e5e7eb' }}>Date</th>
                <th style={{ padding: '0.5rem', border: '1px solid #e5e7eb' }}>Time</th>
                <th style={{ padding: '0.5rem', border: '1px solid #e5e7eb' }}>Status</th>
                <th style={{ padding: '0.5rem', border: '1px solid #e5e7eb' }}>Note</th>
              </tr>
            </thead>
            <tbody>
              {systemLogs.map(log => (
                <tr key={log.id}>
                  <td style={{ padding: '0.5rem', border: '1px solid #e5e7eb' }}>{log.id}</td>
                  <td style={{ padding: '0.5rem', border: '1px solid #e5e7eb' }}>{log.machineName}</td>
                  <td style={{ padding: '0.5rem', border: '1px solid #e5e7eb' }}>{log.userName}</td>
                  <td style={{ padding: '0.5rem', border: '1px solid #e5e7eb' }}>{log.enterDate}</td>
                  <td style={{ padding: '0.5rem', border: '1px solid #e5e7eb' }}>{log.enterTime}</td>
                  <td style={{ padding: '0.5rem', border: '1px solid #e5e7eb' }}>{log.status}</td>
                  <td style={{ padding: '0.5rem', border: '1px solid #e5e7eb' }}>{log.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        );
      case 'server':
        return (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '1rem' }}>
            <thead>
              <tr style={{ backgroundColor: '#f3f4f6', textAlign: 'left' }}>
                <th style={{ padding: '0.5rem', border: '1px solid #e5e7eb' }}>ID</th>
                <th style={{ padding: '0.5rem', border: '1px solid #e5e7eb' }}>Status</th>
                <th style={{ padding: '0.5rem', border: '1px solid #e5e7eb' }}>Date</th>
                <th style={{ padding: '0.5rem', border: '1px solid #e5e7eb' }}>Time</th>
                <th style={{ padding: '0.5rem', border: '1px solid #e5e7eb' }}>Note</th>
              </tr>
            </thead>
            <tbody>
              {serverLogs.map(log => (
                <tr key={log.id}>
                  <td style={{ padding: '0.5rem', border: '1px solid #e5e7eb' }}>{log.id}</td>
                  <td style={{ padding: '0.5rem', border: '1px solid #e5e7eb' }}>{log.status}</td>
                  <td style={{ padding: '0.5rem', border: '1px solid #e5e7eb' }}>{log.recordDate}</td>
                  <td style={{ padding: '0.5rem', border: '1px solid #e5e7eb' }}>{log.recordTime}</td>
                  <td style={{ padding: '0.5rem', border: '1px solid #e5e7eb' }}>{log.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        );
      case 'webhistory':
        return (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '1rem' }}>
            <thead>
              <tr style={{ backgroundColor: '#f3f4f6', textAlign: 'left' }}>
                <th style={{ padding: '0.5rem', border: '1px solid #e5e7eb' }}>ID</th>
                <th style={{ padding: '0.5rem', border: '1px solid #e5e7eb' }}>Machine</th>
                <th style={{ padding: '0.5rem', border: '1px solid #e5e7eb' }}>URL</th>
                <th style={{ padding: '0.5rem', border: '1px solid #e5e7eb' }}>User</th>
                <th style={{ padding: '0.5rem', border: '1px solid #e5e7eb' }}>Date</th>
              </tr>
            </thead>
            <tbody>
              {webHistoryLogs.map(log => (
                <tr key={log.id}>
                  <td style={{ padding: '0.5rem', border: '1px solid #e5e7eb' }}>{log.id}</td>
                  <td style={{ padding: '0.5rem', border: '1px solid #e5e7eb' }}>{log.machine}</td>
                  <td style={{ padding: '0.5rem', border: '1px solid #e5e7eb' }}>{log.url}</td>
                  <td style={{ padding: '0.5rem', border: '1px solid #e5e7eb' }}>{log.userName}</td>
                  <td style={{ padding: '0.5rem', border: '1px solid #e5e7eb' }}>{log.recordDate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        );
      case 'voucher':
        return (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '1rem' }}>
            <thead>
              <tr style={{ backgroundColor: '#f3f4f6', textAlign: 'left' }}>
                <th style={{ padding: '0.5rem', border: '1px solid #e5e7eb' }}>ID</th>
                <th style={{ padding: '0.5rem', border: '1px solid #e5e7eb' }}>Voucher No</th>
                <th style={{ padding: '0.5rem', border: '1px solid #e5e7eb' }}>Machine</th>
                <th style={{ padding: '0.5rem', border: '1px solid #e5e7eb' }}>Amount</th>
                <th style={{ padding: '0.5rem', border: '1px solid #e5e7eb' }}>Date</th>
                <th style={{ padding: '0.5rem', border: '1px solid #e5e7eb' }}>Note</th>
              </tr>
            </thead>
            <tbody>
              {voucherLogs.map(log => (
                <tr key={log.voucherId}>
                  <td style={{ padding: '0.5rem', border: '1px solid #e5e7eb' }}>{log.voucherId}</td>
                  <td style={{ padding: '0.5rem', border: '1px solid #e5e7eb' }}>{log.voucherNo}</td>
                  <td style={{ padding: '0.5rem', border: '1px solid #e5e7eb' }}>{log.machineName}</td>
                  <td style={{ padding: '0.5rem', border: '1px solid #e5e7eb' }}>{log.amount}</td>
                  <td style={{ padding: '0.5rem', border: '1px solid #e5e7eb' }}>{log.voucherDate}</td>
                  <td style={{ padding: '0.5rem', border: '1px solid #e5e7eb' }}>{log.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        );
    }
  };

  return (
    <div style={{ padding: '2rem' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem' }}>Logs Viewer</h1>
      
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', borderBottom: '1px solid #e5e7eb', paddingBottom: '1rem' }}>
        <button 
          style={{ padding: '0.5rem 1rem', cursor: 'pointer', fontWeight: activeTab === 'system' ? 'bold' : 'normal', backgroundColor: activeTab === 'system' ? '#e5e7eb' : 'transparent', border: 'none', borderRadius: '4px' }}
          onClick={() => setActiveTab('system')}
        >
          System Logs
        </button>
        <button 
          style={{ padding: '0.5rem 1rem', cursor: 'pointer', fontWeight: activeTab === 'server' ? 'bold' : 'normal', backgroundColor: activeTab === 'server' ? '#e5e7eb' : 'transparent', border: 'none', borderRadius: '4px' }}
          onClick={() => setActiveTab('server')}
        >
          Server Logs
        </button>
        <button 
          style={{ padding: '0.5rem 1rem', cursor: 'pointer', fontWeight: activeTab === 'webhistory' ? 'bold' : 'normal', backgroundColor: activeTab === 'webhistory' ? '#e5e7eb' : 'transparent', border: 'none', borderRadius: '4px' }}
          onClick={() => setActiveTab('webhistory')}
        >
          Web History
        </button>
        <button 
          style={{ padding: '0.5rem 1rem', cursor: 'pointer', fontWeight: activeTab === 'voucher' ? 'bold' : 'normal', backgroundColor: activeTab === 'voucher' ? '#e5e7eb' : 'transparent', border: 'none', borderRadius: '4px' }}
          onClick={() => setActiveTab('voucher')}
        >
          Voucher Logs
        </button>
      </div>

      <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
        <button 
          onClick={handleTruncate}
          style={{ padding: '0.5rem 1rem', backgroundColor: '#ef4444', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
        >
          Truncate {activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} Logs
        </button>
      </div>

      <div style={{ overflowX: 'auto' }}>
        {renderTable()}
      </div>
    </div>
  );
}
