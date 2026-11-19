import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

function current(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

/** Tema eski sahifalar bilan umumiy ('pos_theme' kaliti) */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(current);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('pos_theme', theme); } catch { /* yopiq */ }
  }, [theme]);

  const toggle = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);
  return [theme, toggle];
}
