import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Loads data with `fn`, re-running when `deps` change. `reload()` refreshes quietly
 * (keeps showing current data) which is what real-time updates use.
 */
export function useAsync(fn, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const seq = useRef(0);

  const run = useCallback(async (quiet = false) => {
    const id = ++seq.current;
    if (!quiet) setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fnRef.current();
      if (id === seq.current) setState({ data, error: null, loading: false });
    } catch (error) {
      if (id === seq.current) setState((s) => ({ data: quiet ? s.data : null, error, loading: false }));
    }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { run(false); }, deps);

  return { ...state, reload: () => run(true), setData: (data) => setState((s) => ({ ...s, data })) };
}
