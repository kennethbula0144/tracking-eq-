import { useState, useEffect } from 'react';
import type { Equipment, EquipmentStatus } from '../lib/supabase';
import { STATUS_META } from '../lib/utils';

interface Props {
  equipment: Equipment | null;
  onSave: (data: Partial<Equipment>) => void;
  onClose: () => void;
}

export default function EquipmentModal({ equipment, onSave, onClose }: Props) {
  const [name, setName] = useState('');
  const [rfidUid, setRfidUid] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<EquipmentStatus | ''>('available');

  useEffect(() => {
    if (equipment) {
      setName(equipment.name);
      setRfidUid(equipment.rfid_uid);
      setDescription(equipment.description ?? '');
      setStatus(equipment.status === 'in_use' ? '' : equipment.status);
    }
  }, [equipment]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !rfidUid.trim()) return;
    onSave({
      name: name.trim(),
      rfid_uid: rfidUid.trim(),
      description: description.trim() || null,
      ...(status ? { status } : {}),
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{equipment ? 'Edit Equipment' : 'Add Equipment'}</h2>
          <button className="close-btn" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <form className="modal-body" onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Equipment Name</label>
            <input
              className="form-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Circular Saw"
              autoFocus
            />
          </div>
          <div className="form-group">
            <label className="form-label">RFID Tag UID</label>
            <input
              className="form-input mono"
              value={rfidUid}
              onChange={(e) => setRfidUid(e.target.value)}
              placeholder="e.g. A1 B2 C3 D4"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Description (optional)</label>
            <textarea
              className="form-textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Notes about this equipment…"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Status</label>
            <select
              className="form-select"
              value={status}
              onChange={(e) => setStatus(e.target.value as EquipmentStatus | '')}
            >
              {equipment?.status === 'in_use' && (
                <option value="">Leave current status (In Use)</option>
              )}
              {(Object.keys(STATUS_META) as EquipmentStatus[])
                .filter((s) => s !== 'in_use')
                .map((s) => (
                  <option key={s} value={s}>{STATUS_META[s].label}</option>
                ))}
            </select>
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">
              {equipment ? 'Save Changes' : 'Add Equipment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
