import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import type { Borrow, Equipment } from '../lib/supabase';
import { formatRelative, formatDate } from '../lib/utils';
import FirmwareStatus from './FirmwareStatus';
import Toast from './Toast';

type ToastItem = { id: number; message: string; type: 'success' | 'error' };

export default function UserDashboard() {
  const [borrows, setBorrows] = useState<Borrow[]>([]);
  const [availableEquipment, setAvailableEquipment] = useState<Equipment[]>([]);
  const [equipmentLoading, setEquipmentLoading] = useState(true);
  const [equipmentError, setEquipmentError] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastId = useRef(0);
  const toastTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const [fullName, setFullName] = useState('');
  const [studentNumber, setStudentNumber] = useState('');
  const [selectedEquipmentId, setSelectedEquipmentId] = useState('');
  const [returnDate, setReturnDate] = useState('');
  const returnDateInput = useRef<HTMLInputElement>(null);

  const showToast = useCallback((message: string, type: ToastItem['type'] = 'success') => {
    const id = ++toastId.current;
    setToasts((previous) => [...previous, { id, message, type }]);
    toastTimers.current.set(id, setTimeout(() => {
      setToasts((previous) => previous.filter((toast) => toast.id !== id));
      toastTimers.current.delete(id);
    }, 3000));
  }, []);

  useEffect(() => () => {
    toastTimers.current.forEach(clearTimeout);
    toastTimers.current.clear();
  }, []);

  const fetchAvailableEquipment = useCallback(async () => {
    setEquipmentLoading(true);
    const { data, error } = await supabase
      .from('equipment')
      .select('*')
      .eq('status', 'available')
      .order('name', { ascending: true });

    if (error) {
      setEquipmentError(`Failed to load available equipment: ${error.message}`);
    } else {
      setAvailableEquipment(data as Equipment[]);
      setEquipmentError('');
    }
    setEquipmentLoading(false);
  }, []);

  const fetchBorrows = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('borrows')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      setHistoryError(`Failed to load borrow history: ${error.message}`);
    } else {
      setBorrows(data as Borrow[]);
      setHistoryError('');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchBorrows();
    fetchAvailableEquipment();

    const channel = supabase
      .channel('borrows-user')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'borrows' }, (payload) => {
        fetchBorrows();
        if (payload.eventType === 'UPDATE') {
          const borrow = payload.new as Borrow;
          const previous = payload.old as Partial<Borrow>;
          if (previous.status && previous.status !== borrow.status) {
            const message = borrow.status === 'approved'
              ? `${borrow.item_name} borrow request approved.`
              : borrow.status === 'returned'
                ? `${borrow.item_name} return confirmed.`
                : `${borrow.item_name} borrow request updated.`;
            showToast(message);
          }
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'equipment' }, () => {
        fetchAvailableEquipment();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchAvailableEquipment, fetchBorrows, showToast]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const selectedEquipment = availableEquipment.find((item) => item.id === selectedEquipmentId);
    if (!fullName.trim() || !studentNumber.trim() || !selectedEquipment || !returnDate) {
      showToast('Please fill in all fields.', 'error');
      return;
    }

    setSubmitting(true);
    const { data, error: insertError } = await supabase
      .from('borrows')
      .insert({
        full_name: fullName.trim(),
        student_number: studentNumber.trim(),
        rfid_uid: selectedEquipment.rfid_uid.replace(/\s+/g, '').toUpperCase(),
        item_name: selectedEquipment.name,
        return_date: returnDate,
        status: 'pending',
      })
      .select('id')
      .single();

    if (insertError) {
      showToast(insertError.message || 'Failed to submit borrow request.', 'error');
      setSubmitting(false);
      return;
    }

    // Call the edge function to notify admins
    if (data?.id) {
      try {
        const funcUrl = `${(import.meta as any).env.VITE_SUPABASE_URL}/functions/v1/notify-borrow`;
        const { data: sessionData } = await supabase.auth.getSession();
        await fetch(funcUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${sessionData.session?.access_token}`,
            apikey: (import.meta as any).env.VITE_SUPABASE_PUBLISHABLE_KEY ?? (import.meta as any).env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ borrowId: data.id }),
        });
      } catch {
        // Notification failed silently — borrow still succeeded
      }
    }

    setFullName('');
    setStudentNumber('');
    setSelectedEquipmentId('');
    setReturnDate('');
    showToast('Borrow request submitted.');
    setSubmitting(false);
    fetchBorrows();
  };

  return (
    <div className="app">
      <div className="toast-container" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => (
          <Toast key={toast.id} message={toast.message} type={toast.type} />
        ))}
      </div>
      <header className="header">
        <div className="header-left">
          <div className="logo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2z" />
              <path d="M8 11h.01M12 11h.01M16 11h.01" />
            </svg>
          </div>
          <div>
            <h1>User Dashboard</h1>
            <div className="header-sub">Submit an equipment borrow request</div>
          </div>
        </div>
        <div className="header-right">
          <FirmwareStatus />
        </div>
      </header>

      <main className="main">
        <div className="borrow-form-panel">
          <div className="panel-header">
            <div className="panel-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18, color: 'var(--text-secondary)' }}>
                <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
              Borrow Equipment
            </div>
          </div>
          <div className="panel-body" style={{ padding: '24px' }}>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label">Full Name</label>
                <input
                  className="form-input"
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. Juan Dela Cruz"
                  required
                />
                <div className="form-hint">Enter your full name exactly as it appears on your school records.</div>
              </div>
              <div className="form-group">
                <label className="form-label">Student Number</label>
                <input
                  className="form-input"
                  type="text"
                  value={studentNumber}
                  onChange={(e) => setStudentNumber(e.target.value)}
                  placeholder="e.g. 2024-12345"
                  required
                />
                <div className="form-hint">Provide your student number for verification.</div>
              </div>
              <div className="form-group">
                <label className="form-label">Item to Borrow</label>
                <select
                  className="form-select"
                  value={selectedEquipmentId}
                  onChange={(e) => setSelectedEquipmentId(e.target.value)}
                  required
                  disabled={equipmentLoading || availableEquipment.length === 0}
                >
                  <option value="">
                    {equipmentLoading ? 'Loading available equipment…' : 'Select available equipment'}
                  </option>
                  {availableEquipment.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} ({item.rfid_uid})
                    </option>
                  ))}
                </select>
                <div className="form-hint">
                  {equipmentError ||
                    (availableEquipment.length === 0 && !equipmentLoading
                      ? 'No equipment is currently available.'
                      : 'Only available equipment is listed.')}
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Return Date</label>
                <div className="date-picker-control">
                  <input
                    ref={returnDateInput}
                    className="form-input"
                    type="date"
                    value={returnDate}
                    onChange={(e) => setReturnDate(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    className="date-picker-trigger"
                    aria-label="Open return date calendar"
                    title="Choose a return date"
                    onClick={() => {
                      const input = returnDateInput.current;
                      if (!input) return;
                      if (typeof input.showPicker === 'function') input.showPicker();
                      else {
                        input.focus();
                        input.click();
                      }
                    }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="3" y="5" width="18" height="16" rx="2" />
                      <path d="M16 3v4M8 3v4M3 11h18" />
                    </svg>
                  </button>
                </div>
                <div className="form-hint">When will you return this item?</div>
              </div>

              <button
                type="submit"
                className="btn btn-primary"
                disabled={submitting || equipmentLoading || availableEquipment.length === 0 || Boolean(equipmentError)}
                style={{ width: '100%', justifyContent: 'center' }}
              >
                {submitting ? 'Submitting…' : 'Submit Borrow Request'}
              </button>
            </form>
          </div>
        </div>

        <div className="panel" style={{ marginTop: '24px' }}>
          <div className="panel-header">
            <div className="panel-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18, color: 'var(--text-secondary)' }}>
                <path d="M3 3v18h18" /><path d="m19 9-5 5-4-4-3 3" />
              </svg>
              Borrow History
            </div>
          </div>
          <div className="panel-body">
            {historyError && <div className="auth-error" style={{ marginBottom: '16px' }}>{historyError}</div>}
            {loading ? (
              <div className="loading-bar" />
            ) : borrows.length === 0 ? (
              <div className="empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
                <h3>No borrows yet</h3>
                <p>Submit a borrow request using the form above</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>RFID UID</th>
                      <th>Return Date</th>
                      <th>Status</th>
                      <th>Requested</th>
                    </tr>
                  </thead>
                  <tbody>
                    {borrows.map((b) => (
                      <tr key={b.id}>
                        <td style={{ fontWeight: 500 }}>{b.item_name}</td>
                        <td className="mono" style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>{b.rfid_uid}</td>
                        <td>{formatDate(b.return_date)}</td>
                        <td>
                          <span className={`borrow-status borrow-status-${b.status}`}>
                            {b.status.charAt(0).toUpperCase() + b.status.slice(1)}
                          </span>
                        </td>
                        <td style={{ color: 'var(--text-secondary)' }}>{formatRelative(b.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
