export type Theme = 'light' | 'dark' | 'system';

export function getStoredTheme(): Theme {
  return (localStorage.getItem('theme') as Theme) || 'system';
}

export function setStoredTheme(t: Theme) {
  localStorage.setItem('theme', t);
  applyStoredTheme();
}

export function applyStoredTheme() {
  const t = getStoredTheme();
  const dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}
