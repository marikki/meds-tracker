import { useEffect } from 'react';

/** Викликає fn, коли застосунок знову на екрані (повернулися з фону, перемкнули вкладку). */
export function useOnVisible(fn: () => void) {
  useEffect(() => {
    const onChange = () => {
      if (document.visibilityState === 'visible') fn();
    };
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, [fn]);
}
