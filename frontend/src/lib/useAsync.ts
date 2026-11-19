import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './api';

interface State<T> {
  data: T | null;
  loading: boolean;
  error: ApiError | null;
}

/**
 * Ma'lumot yuklash: birinchi marta skelet, keyingi yangilashlarda eski ma'lumot
 * ekranda qoladi (lip-lip qilmaydi).
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<State<T>>({ data: null, loading: true, error: null });
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fn();
      if (alive.current) setState({ data, loading: false, error: null });
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(String(e));
      if (alive.current) setState((s) => ({ ...s, loading: false, error: err }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload, setData: (d: T) => setState((s) => ({ ...s, data: d })) };
}
