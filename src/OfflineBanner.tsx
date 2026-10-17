import { useEffect, useState } from 'react';

export function OfflineBanner() {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  if (online) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-50 bg-amber-100 px-4 py-1.5 text-center text-xs text-amber-900 shadow-sm"
      style={{ paddingTop: 'max(0.375rem, env(safe-area-inset-top))' }}
    >
      Офлайн — показано збережені дані
    </div>
  );
}
