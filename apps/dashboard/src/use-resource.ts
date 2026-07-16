import { useCallback, useEffect, useRef, useState } from 'react';

export interface ResourceState<T> {
  data?: T;
  error?: string;
  loading: boolean;
  refreshing: boolean;
  reload(): void;
}

export function useResource<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  key: string,
): ResourceState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [version, setVersion] = useState(0);
  const [pending, setPending] = useState(true);
  const hasData = useRef(false);
  const reload = useCallback(() => setVersion((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setPending(true);
    setError(undefined);
    void loader(controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return;
        hasData.current = true;
        setData(next);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : 'The request failed.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setPending(false);
      });
    return () => controller.abort();
  }, [key, loader, version]);

  return {
    ...(data === undefined ? {} : { data }),
    ...(error === undefined ? {} : { error }),
    loading: pending && !hasData.current,
    refreshing: pending && hasData.current,
    reload,
  };
}
