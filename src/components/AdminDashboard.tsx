import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import type { Borrow, Notification, Equipment, Device, ScanLogWithRelations, EquipmentStatus } from '../lib/supabase';
import { STATUS_META, ACTION_META, formatRelative, formatDateTime, formatDate } from '../lib/utils';
import EquipmentModal from './EquipmentModal';
import EquipmentDetail from './EquipmentDetail';
import FirmwareStatus from './FirmwareStatus';

type Tab = 'borrows' | 'equipment' | 'history';
type ToastItem = { id: number; msg: string; type: 'success' | 'error' };

export default function AdminDashboard() {
  const [tab, setTab] = useState<Tab>('borrows');
  const [borrows, setBorrows] = useState<Borrow[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [notificationLoadError, setNotificationLoadError] = useState('');
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [scans, setScans] = useState<ScanLogWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [borrowLoadError, setBorrowLoadError] = useState('');
  const [connected, setConnected] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<EquipmentStatus | 'all'>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Equipment | null>(null);
  const [detailItem, setDetailItem] = useState<Equipment | null>(null);
  const [notificationMenuOpen, setNotificationMenuOpen] = useState(false);
  const notificationMenuRef = useRef<HTMLDivElement>(null);
  const [updatingNotificationIds, setUpdatingNotificationIds] = useState<Set<string>>(() => new Set());
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastId = useRef(0);
  const toastTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const showToast = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    const id = ++toastId.current;
    setToasts((prev) => [...prev, { id, msg, type }]);
    toastTimers.current.set(id, setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
      toastTimers.current.delete(id);
    }, 3000));
  }, []);

  useEffect(() => () => {
    toastTimers.current.forEach(clearTimeout);
    toastTimers.current.clear();
  }, []);

  useEffect(() => {
    if (!notificationMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!notificationMenuRef.current?.contains(event.target as Node)) {
        setNotificationMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setNotificationMenuOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [notificationMenuOpen]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [borrowRes, notifRes, eqRes, devRes, scanRes] = await Promise.all([
      supabase.from('borrows')
        .select('*')
        .order('created_at', { ascending: false }),
      supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('equipment').select('*').order('created_at', { ascending: false }),
      supabase.from('devices').select('*').order('created_at', { ascending: false }),
      supabase
        .from('scan_logs')
        .select('*, equipment(name, rfid_uid), devices(device_name, location)')
        .order('created_at', { ascending: false })
        .limit(200),
    ]);

    if (borrowRes.error) {
      setBorrowLoadError(`Failed to load borrow requests: ${borrowRes.error.message}`);
    } else {
      setBorrowLoadError('');
      setBorrows(borrowRes.data as Borrow[]);
    }
    if (notifRes.error) {
      setNotificationLoadError(`Failed to load notifications: ${notifRes.error.message}`);
    } else {
      setNotifications(notifRes.data as Notification[]);
      setNotificationLoadError('');
    }
    if (eqRes.data) setEquipment(eqRes.data as Equipment[]);
    if (devRes.data) setDevices(devRes.data as Device[]);
    if (scanRes.data) setScans(scanRes.data as ScanLogWithRelations[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAll();

    const channel = supabase
      .channel('admin-dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'borrows' }, (payload) => {
        fetchAll();
        if (payload.eventType === 'INSERT') {
          const borrow = payload.new as Borrow;
          showToast(`New borrow request: ${borrow.item_name} from ${borrow.full_name || 'Unknown borrower'}`);
        } else if (payload.eventType === 'UPDATE') {
          const borrow = payload.new as Borrow;
          if (borrow.status === 'approved') {
            showToast(`Borrow approved: ${borrow.item_name}`);
          } else if (borrow.status === 'returned') {
            showToast(`Borrow returned: ${borrow.item_name}`);
          } else {
            showToast(`Borrow request updated: ${borrow.item_name}`);
          }
        } else if (payload.eventType === 'DELETE') {
          showToast('A borrow request was deleted');
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          const notification = payload.new as Notification;
          setNotifications((prev) => [notification, ...prev.filter((n) => n.id !== notification.id)].slice(0, 100));
          if (notification.type !== 'borrow_request') {
            showToast(notification.message
              ? `${notification.title}: ${notification.message}`
              : notification.title);
          }
        } else if (payload.eventType === 'UPDATE') {
          const notification = payload.new as Notification;
          setNotifications((prev) => prev.map((n) => (n.id === notification.id ? notification : n)));
        } else if (payload.eventType === 'DELETE') {
          const deleted = payload.old as Notification;
          setNotifications((prev) => prev.filter((n) => n.id !== deleted.id));
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'equipment' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          const item = payload.new as Equipment;
          setEquipment((prev) => [item, ...prev]);
          showToast(`Equipment added: ${item.name}`);
        } else if (payload.eventType === 'UPDATE') {
          const item = payload.new as Equipment;
          const previous = payload.old as Partial<Equipment>;
          setEquipment((prev) => prev.map((e) => (e.id === item.id ? item : e)));
          if (previous.status && previous.status !== item.status) {
            showToast(`${item.name} status changed to ${STATUS_META[item.status].label}`);
          }
        } else if (payload.eventType === 'DELETE') {
          const item = payload.old as Equipment;
          setEquipment((prev) => prev.filter((e) => e.id !== (payload.old as Equipment).id));
          showToast(`Equipment removed: ${item.name || 'item'}`);
        }
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'scan_logs' }, async (payload) => {
        const newLog = payload.new as ScanLogWithRelations;
        const actionLabel = ACTION_META[newLog.action]?.label ?? newLog.action;
        showToast(`RFID scan: ${actionLabel} (${newLog.rfid_uid})`);
        const eqRes = await supabase.from('equipment').select('name, rfid_uid').eq('id', newLog.equipment_id ?? '').maybeSingle();
        const devRes = await supabase.from('devices').select('device_name, location').eq('id', newLog.device_id ?? '').maybeSingle();
        newLog.equipment = eqRes.data;
        newLog.devices = devRes.data;
        setScans((prev) => [newLog, ...prev].slice(0, 200));

      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'devices' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setDevices((prev) => [payload.new as Device, ...prev]);
        } else if (payload.eventType === 'UPDATE') {
          setDevices((prev) =>
            prev.map((d) => (d.id === (payload.new as Device).id ? (payload.new as Device) : d)),
          );
        }
      })
      .subscribe((status) => {
        setConnected(status === 'SUBSCRIBED');
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchAll, showToast]);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const returnScanTimes = new Map<string, number>();
  scans.forEach((scan) => {
    if (scan.action !== 'return_pending_admin') return;
    const uid = scan.rfid_uid.replace(/\s+/g, '').toUpperCase();
    const scanTime = new Date(scan.created_at).getTime();
    if (scanTime > (returnScanTimes.get(uid) ?? 0)) returnScanTimes.set(uid, scanTime);
  });

  const handleReturnBorrow = async (id: string) => {
    const { data, error } = await supabase.rpc('mark_borrow_returned', {
      p_request_id: id,
    });
    if (error) {
      showToast(`Failed to mark as returned: ${error.message}`, 'error');
    } else if (!data?.returned) {
      showToast(data?.error || 'Failed to mark as returned', 'error');
    } else {
      showToast('Item marked as returned');
      fetchAll();
    }
  };

  const handleMarkNotifRead = async (id: string) => {
    setUpdatingNotificationIds((prev) => new Set(prev).add(id));
    try {
      const { error } = await supabase.from('notifications').update({ is_read: true }).eq('id', id);
      if (error) {
        showToast(`Failed to mark notification as read: ${error.message}`, 'error');
        return;
      }
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    } finally {
      setUpdatingNotificationIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleDeleteNotification = async (id: string) => {
    setUpdatingNotificationIds((prev) => new Set(prev).add(id));
    try {
      const { data, error } = await supabase
        .from('notifications')
        .delete()
        .eq('id', id)
        .select('id')
        .maybeSingle();

      if (error) {
        showToast(`Failed to delete notification: ${error.message}`, 'error');
        return;
      }
      if (!data) {
        showToast('Notification was not deleted. Check the database permissions.', 'error');
        return;
      }

      setNotifications((prev) => prev.filter((n) => n.id !== id));
      showToast('Notification deleted');
    } finally {
      setUpdatingNotificationIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleMarkAllRead = async () => {
    if (unreadCount === 0) return;
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('is_read', false);
    if (error) {
      showToast(`Failed to mark notifications as read: ${error.message}`, 'error');
      return;
    }
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    showToast('All notifications marked as read');
  };

  const handleSave = async (data: Partial<Equipment>) => {
    let saveError = '';
    let borrowReturned = false;
    if (editing) {
      if (data.status && data.status !== editing.status) {
        const { data: result, error: statusError } = await supabase.rpc('admin_change_equipment_status', {
          p_equipment_id: editing.id,
          p_status: data.status,
        });
        if (statusError) {
          saveError = statusError.message;
        } else if (!result?.updated) {
          saveError = result?.error || 'Failed to update equipment status';
        } else {
          borrowReturned = Boolean(result.borrow_returned);
        }
      }
      if (!saveError) {
        const { error } = await supabase
          .from('equipment')
          .update({
            name: data.name,
            description: data.description,
            rfid_uid: data.rfid_uid,
          })
          .eq('id', editing.id);
        if (error) saveError = error.message;
      }
    } else {
      const { error } = await supabase.from('equipment').insert({
        name: data.name!,
        rfid_uid: data.rfid_uid!,
        description: data.description,
        status: data.status ?? 'available',
      });
      if (error) saveError = error.message;
    }
    if (saveError) {
      showToast(`Failed to save equipment: ${saveError}`, 'error');
      return;
    }
    showToast(
      borrowReturned
        ? 'Equipment updated and active borrow marked as returned'
        : editing
          ? 'Equipment updated'
          : 'Equipment added',
    );
    setModalOpen(false);
    setEditing(null);
    fetchAll();
  };

  const handleDelete = async (id: string) => {
    const confirmed = window.confirm('Delete this equipment record? This action cannot be undone.');
    if (!confirmed) return;
    const { error } = await supabase.from('equipment').delete().eq('id', id);
    if (error) {
      showToast('Failed to delete', 'error');
      return;
    }
    setEquipment((prev) => prev.filter((item) => item.id !== id));
    setDetailItem(null);
    showToast('Equipment deleted');
  };

  const handleStatusChange = async (item: Equipment, status: EquipmentStatus) => {
    const { data, error } = await supabase.rpc('admin_change_equipment_status', {
      p_equipment_id: item.id,
      p_status: status,
    });
    if (error) {
      showToast(`Failed to update status: ${error.message}`, 'error');
      return;
    }
    if (!data?.updated) {
      showToast(data?.error || 'Failed to update status', 'error');
      return;
    }
    showToast(data.borrow_returned
      ? `Status changed to ${STATUS_META[status].label}; active borrow marked as returned`
      : `Status changed to ${STATUS_META[status].label}`);
    setDetailItem(null);
    fetchAll();
  };

  const filteredEquipment = equipment.filter((e) => {
    if (statusFilter !== 'all' && e.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        e.name.toLowerCase().includes(q) ||
        e.rfid_uid.toLowerCase().includes(q) ||
        (e.description?.toLowerCase().includes(q) ?? false)
      );
    }
    return true;
  });

  const stats = {
    totalBorrows: borrows.length,
    pending: borrows.filter((b) => b.status === 'pending').length,
    approved: borrows.filter((b) => b.status === 'approved').length,
    returned: borrows.filter((b) => b.status === 'returned').length,
    totalEquipment: equipment.length,
  };

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <div className="logo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2z" />
              <path d="M8 11h.01M12 11h.01M16 11h.01" />
            </svg>
          </div>
          <div>
            <h1>Admin Dashboard</h1>
            <div className="header-sub">Manage equipment and borrow requests</div>
          </div>
        </div>
        <div className="header-right">
          <div className="header-notification-menu" ref={notificationMenuRef}>
            <button
              className={`header-notification-button ${notificationMenuOpen ? 'active' : ''}`}
              type="button"
              onClick={() => setNotificationMenuOpen((open) => !open)}
              aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
              aria-expanded={notificationMenuOpen}
              aria-haspopup="true"
              title="Notifications"
            >
              <IconBell />
              {unreadCount > 0 && <span className="header-notification-count">{unreadCount}</span>}
            </button>
            {notificationMenuOpen && (
              <div className="notification-dropdown" aria-label="Notifications">
                <div className="notification-dropdown-header">
                  <strong>Notifications</strong>
                  {unreadCount > 0 && (
                    <button className="notification-mark-all" type="button" onClick={handleMarkAllRead}>
                      Mark all read
                    </button>
                  )}
                </div>
                <div className="notification-dropdown-list">
                  {notificationLoadError ? (
                    <div className="notification-dropdown-error" role="alert">
                      {notificationLoadError}
                    </div>
                  ) : notifications.length === 0 ? (
                    <div className="notification-dropdown-empty">No notifications yet</div>
                  ) : (
                    notifications.map((notification) => (
                      <div
                        className={`notification-dropdown-item ${notification.is_read ? 'read' : 'unread'}`}
                        key={notification.id}
                      >
                        <span className="notification-dropdown-content">
                          <span className="notification-dropdown-title">{notification.title}</span>
                          <span className="notification-dropdown-message">{notification.message}</span>
                          <span className="notification-dropdown-time">{formatRelative(notification.created_at)}</span>
                          <span className="notification-dropdown-actions">
                            {!notification.is_read && (
                              <button
                                className="notification-action"
                                type="button"
                                disabled={updatingNotificationIds.has(notification.id)}
                                onClick={() => void handleMarkNotifRead(notification.id)}
                              >
                                Mark as read
                              </button>
                            )}
                            <button
                              className="notification-action delete"
                              type="button"
                              disabled={updatingNotificationIds.has(notification.id)}
                              onClick={() => void handleDeleteNotification(notification.id)}
                            >
                              Delete
                            </button>
                          </span>
                        </span>
                        {!notification.is_read && <span className="notif-dot" />}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
          <FirmwareStatus />
          <div className={`connection-badge ${connected ? 'live' : 'offline'}`}>
            <span className="pulse" />
            {connected ? 'Live' : 'Connecting…'}
          </div>
        </div>
      </header>

      <main className="main">
        <div className="stats-grid">
          <StatCard icon={<IconBox />} value={stats.totalEquipment} label="Equipment" color="#3b82f6" />
          <StatCard icon={<IconClock />} value={stats.pending} label="Pending Borrows" color="#eab308" />
          <StatCard icon={<IconCheck />} value={stats.approved} label="Approved" color="#22c55e" />
          <StatCard icon={<IconReturn />} value={stats.returned} label="Returned" color="#06b6d4" />
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="tabs">
              <button className={`tab ${tab === 'borrows' ? 'active' : ''}`} onClick={() => setTab('borrows')}>
                <IconBox /> Borrows
              </button>
              <button className={`tab ${tab === 'equipment' ? 'active' : ''}`} onClick={() => setTab('equipment')}>
                <IconGrid /> Equipment
              </button>
              <button className={`tab ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>
                <IconHistory /> Scan History
              </button>
            </div>
            {tab === 'equipment' && (
              <button className="btn btn-primary" onClick={() => { setEditing(null); setModalOpen(true); }}>
                <IconPlus /> Add Equipment
              </button>
            )}
          </div>

          {loading && <div className="loading-bar" />}

          <div className="panel-body">
            {tab === 'borrows' && (
              <BorrowsTab
                borrows={borrows}
                returnScanTimes={returnScanTimes}
                error={borrowLoadError}
                onReturn={handleReturnBorrow}
              />
            )}
            {tab === 'equipment' && (
              <EquipmentTab
                equipment={filteredEquipment}
                search={search}
                setSearch={setSearch}
                statusFilter={statusFilter}
                setStatusFilter={setStatusFilter}
                onCardClick={setDetailItem}
              />
            )}
            {tab === 'history' && <HistoryTab scans={scans} />}
          </div>
        </div>
      </main>

      {modalOpen && (
        <EquipmentModal
          equipment={editing}
          onSave={handleSave}
          onClose={() => { setModalOpen(false); setEditing(null); }}
        />
      )}
      {detailItem && (
        <EquipmentDetail
          equipment={detailItem}
          devices={devices}
          scans={scans.filter((s) => s.equipment_id === detailItem.id)}
          onStatusChange={(s) => handleStatusChange(detailItem, s)}
          onEdit={() => { setEditing(detailItem); setDetailItem(null); setModalOpen(true); }}
          onDelete={() => handleDelete(detailItem.id)}
          onClose={() => setDetailItem(null)}
        />
      )}
      {toasts.length > 0 && (
        <div className="toast-container">
          {toasts.map((toast) => (
            <div className={`toast ${toast.type}`} key={toast.id} role="status">
              {toast.type === 'success' ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18, color: '#22c55e' }}>
                  <path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><path d="m9 11 3 3L22 4" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18, color: '#ef4444' }}>
                  <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" />
                </svg>
              )}
              {toast.msg}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, value, label, color }: { icon: React.ReactNode; value: number; label: string; color: string }) {
  return (
    <div className="stat-card">
      <div className="stat-icon" style={{ background: `${color}1a`, color }}>{icon}</div>
      <div className="stat-info">
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  );
}

function BorrowsTab({
  borrows,
  returnScanTimes,
  error,
  onReturn,
}: {
  borrows: Borrow[];
  returnScanTimes: Map<string, number>;
  error: string;
  onReturn: (id: string) => void;
}) {
  if (borrows.length === 0 && !error) {
    return (
      <div className="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
        </svg>
        <h3>No borrow requests yet</h3>
        <p>When users submit borrow requests, they will appear here</p>
      </div>
    );
  }
  return (
    <>
      {error && (
        <div className="auth-error" role="alert">
          {error}
        </div>
      )}
      {borrows.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Borrower</th>
                <th>Item</th>
                <th>RFID UID</th>
                <th>Return Date</th>
                <th>Status</th>
                <th>Requested</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {borrows.map((b) => {
                const scanTime = returnScanTimes.get(b.rfid_uid.replace(/\s+/g, '').toUpperCase());
                const returnAwaitingReview =
                  b.status === 'approved' &&
                  scanTime !== undefined &&
                  scanTime >= new Date(b.created_at).getTime();
                return (
                  <tr key={b.id}>
                    <td style={{ fontWeight: 500 }}>
                      <div>{b.full_name || 'Anonymous'}</div>
                      {b.student_number && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                          Student # {b.student_number}
                        </div>
                      )}
                    </td>
                    <td>{b.item_name}</td>
                    <td className="mono" style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>{b.rfid_uid}</td>
                    <td>{formatDate(b.return_date)}</td>
                    <td>
                      <span className={`borrow-status ${returnAwaitingReview ? 'borrow-status-return-pending' : `borrow-status-${b.status}`}`}>
                        {returnAwaitingReview
                          ? 'Return Awaiting Review'
                          : b.status === 'approved'
                            ? 'In Use'
                            : b.status.charAt(0).toUpperCase() + b.status.slice(1)}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-secondary)' }}>{formatRelative(b.created_at)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        {b.status === 'pending' && (
                          <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                            Awaiting RFID scan
                          </span>
                        )}
                        {b.status === 'approved' && returnAwaitingReview && (
                          <button className="btn btn-primary" style={{ padding: '6px 12px', fontSize: '0.75rem' }} onClick={() => onReturn(b.id)}>
                            Confirm Return
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function EquipmentTab({
  equipment,
  search,
  setSearch,
  statusFilter,
  setStatusFilter,
  onCardClick,
}: {
  equipment: Equipment[];
  search: string;
  setSearch: (v: string) => void;
  statusFilter: EquipmentStatus | 'all';
  setStatusFilter: (v: EquipmentStatus | 'all') => void;
  onCardClick: (e: Equipment) => void;
}) {
  return (
    <>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }} className="filter-bar">
        <div className="search-wrap">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
          </svg>
          <input
            className="search-input"
            placeholder="Search equipment or tag ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <button
            className={`filter-btn ${statusFilter === 'all' ? 'active' : ''}`}
            onClick={() => setStatusFilter('all')}
          >
            All
          </button>
          {(Object.keys(STATUS_META) as EquipmentStatus[]).map((s) => (
            <button
              key={s}
              className={`filter-btn ${statusFilter === s ? 'active' : ''}`}
              onClick={() => setStatusFilter(s)}
            >
              <span className="dot" style={{ background: STATUS_META[s].dot }} />
              {STATUS_META[s].label}
            </button>
          ))}
        </div>
      </div>
      {equipment.length === 0 ? (
        <div className="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
          </svg>
          <h3>No equipment found</h3>
          <p>Add your first piece of equipment to get started</p>
        </div>
      ) : (
        <div className="equipment-grid">
          {equipment.map((e) => {
            const meta = STATUS_META[e.status];
            return (
              <div key={e.id} className="equip-card" onClick={() => onCardClick(e)}>
                <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '3px', background: meta.dot }} />
                <div className="equip-card-top">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="equip-name">{e.name}</div>
                    {e.description && <div className="equip-desc">{e.description}</div>}
                  </div>
                  <div className="status-badge" style={{ background: meta.bg, color: meta.color }}>
                    <span className="dot" style={{ background: meta.dot }} />
                    {meta.label}
                  </div>
                </div>
                <div className="equip-uid">{e.rfid_uid}</div>
                <div className="equip-footer">
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
                    {formatRelative(e.last_scanned_at)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function HistoryTab({ scans }: { scans: ScanLogWithRelations[] }) {
  if (scans.length === 0) {
    return (
      <div className="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 3v18h18" /><path d="m19 9-5 5-4-4-3 3" />
        </svg>
        <h3>No scan history yet</h3>
        <p>Scan logs will appear here once your device starts reading tags</p>
      </div>
    );
  }
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Equipment</th>
            <th>Tag UID</th>
            <th>Action</th>
            <th>Device</th>
            <th>Device Time</th>
            <th>Logged At</th>
          </tr>
        </thead>
        <tbody>
          {scans.map((s) => (
            <tr key={s.id}>
              <td style={{ fontWeight: 500 }}>{s.equipment?.name ?? '—'}</td>
              <td className="mono" style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>{s.rfid_uid}</td>
              <td>
                <span className="action-badge" style={{ background: ACTION_META[s.action].color + '1a', color: ACTION_META[s.action].color }}>
                  {ACTION_META[s.action].label}
                </span>
              </td>
              <td>{s.devices?.device_name ?? '—'}</td>
              <td style={{ color: 'var(--text-secondary)' }}>{formatDateTime(s.device_timestamp)}</td>
              <td style={{ color: 'var(--text-secondary)' }}>{formatDateTime(s.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* Icon components */
function IconBox() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" /><path d="m3.3 7 8.7 5 8.7-5M12 22V12" /></svg>; }
function IconCheck() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><path d="m9 11 3 3L22 4" /></svg>; }
function IconClock() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>; }
function IconReturn() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>; }
function IconBell() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" /></svg>; }
function IconGrid() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /></svg>; }
function IconHistory() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><path d="m19 9-5 5-4-4-3 3" /></svg>; }
function IconPlus() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>; }
