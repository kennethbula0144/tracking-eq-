import type { Equipment, EquipmentStatus, Device, ScanLogWithRelations } from '../lib/supabase';
import { STATUS_META, ACTION_META, formatRelative, formatDateTime } from '../lib/utils';

interface Props {
  equipment: Equipment;
  devices: Device[];
  scans: ScanLogWithRelations[];
  onStatusChange: (status: EquipmentStatus) => void;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}

export default function EquipmentDetail({ equipment, scans, onStatusChange, onEdit, onDelete, onClose }: Props) {
  const meta = STATUS_META[equipment.status];
  const recentScans = scans.slice(0, 10);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{equipment.name}</h2>
          <button className="close-btn" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="modal-body">
          <div className="status-badge" style={{ background: meta.bg, color: meta.color, marginBottom: '20px' }}>
            <span className="dot" style={{ background: meta.dot }} />
            {meta.label}
          </div>

          {equipment.description && (
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '20px' }}>
              {equipment.description}
            </p>
          )}

          <div className="detail-row">
            <span className="detail-label">RFID UID</span>
            <span className="detail-value mono" style={{ fontSize: '0.8125rem' }}>{equipment.rfid_uid}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Last Scanned</span>
            <span className="detail-value">{formatRelative(equipment.last_scanned_at)}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Created</span>
            <span className="detail-value">{formatDateTime(equipment.created_at)}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Updated</span>
            <span className="detail-value">{formatDateTime(equipment.updated_at)}</span>
          </div>

          <div style={{ marginTop: '20px' }}>
            <div className="form-label" style={{ marginBottom: '10px' }}>Change Status</div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {(Object.keys(STATUS_META) as EquipmentStatus[])
                .filter((status) => status !== 'in_use')
                .map((s) => (
                  <button
                    key={s}
                    className={`filter-btn ${equipment.status === s ? 'active' : ''}`}
                    onClick={() => onStatusChange(s)}
                    disabled={equipment.status === s}
                  >
                    <span className="dot" style={{ background: STATUS_META[s].dot }} />
                    {STATUS_META[s].label}
                  </button>
                ))}
            </div>
            {equipment.status === 'in_use' && (
              <div className="form-hint">Changing to Available will also mark the active borrow as returned.</div>
            )}
          </div>

          {recentScans.length > 0 && (
            <div style={{ marginTop: '24px' }}>
              <div className="form-label" style={{ marginBottom: '10px' }}>Recent Scan History</div>
              <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                {recentScans.map((scan) => (
                  <div key={scan.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                    <span className="action-badge" style={{ background: ACTION_META[scan.action].color + '1a', color: ACTION_META[scan.action].color }}>
                      {ACTION_META[scan.action].label}
                    </span>
                    <span style={{ flex: 1, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {formatDateTime(scan.created_at)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="form-actions" style={{ marginTop: '24px' }}>
            <button className="btn btn-danger" onClick={onDelete}>Delete</button>
            <button className="btn btn-ghost" onClick={onClose}>Close</button>
            <button className="btn btn-primary" onClick={onEdit}>Edit</button>
          </div>
        </div>
      </div>
    </div>
  );
}
