interface Props {
  message: string;
  type: 'success' | 'error';
}

export default function Toast({ message, type }: Props) {
  const color = type === 'success' ? '#22c55e' : '#ef4444';
  return (
    <div className={`toast ${type}`} role="status">
      {type === 'success' ? (
        <svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color }}>
          <path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><path d="m9 11 3 3L22 4" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color }}>
          <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" />
        </svg>
      )}
      {message}
    </div>
  );
}
