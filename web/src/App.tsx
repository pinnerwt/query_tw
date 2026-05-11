import { Routes, Route, NavLink, Link } from 'react-router-dom';
import { Browse } from './pages/Browse';
import { Detail } from './pages/Detail';
import { Settings } from './pages/Settings';
import { Favorites } from './pages/Favorites';
import { Admin } from './pages/Admin';
import { Faq } from './pages/Faq';
import { Privacy } from './pages/Privacy';
import { Terms } from './pages/Terms';
import { useEffect } from 'react';
import { useConfigStore, ensureLoaded } from './state/configStore';
import { RefreshPrompt } from './components/RefreshPrompt';

export default function App() {
  const ready = useConfigStore((s) => s.ready);
  useEffect(() => {
    ensureLoaded();
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <Header />
      <main>
        {ready ? (
          <Routes>
            <Route path="/" element={<Browse />} />
            <Route path="/job/:id" element={<Detail />} />
            <Route path="/favorites" element={<Favorites />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/faq" element={<Faq />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/admin" element={<Admin />} />
          </Routes>
        ) : (
          <div className="p-8 text-center text-sm text-slate-500">載入中…</div>
        )}
      </main>
      <Footer />
      <RefreshPrompt />
    </div>
  );
}

function Footer() {
  return (
    <footer className="mt-12 border-t border-slate-200 py-6 text-center text-xs text-slate-500 dark:border-slate-800">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-4 gap-y-1 px-4">
        <Link to="/privacy" className="hover:underline">隱私權政策</Link>
        <span aria-hidden>·</span>
        <Link to="/terms" className="hover:underline">使用條款</Link>
        <span aria-hidden>·</span>
        <Link to="/faq" className="hover:underline">問與答</Link>
      </div>
    </footer>
  );
}

function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <NavLink to="/" className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900">脆</span>
          <span className="text-lg font-bold">脆找工作</span>
        </NavLink>
        <nav className="flex items-center gap-2 text-sm">
          <NavLink to="/" className={({isActive}) => isActive ? 'btn-primary' : 'btn-ghost'} end>
            瀏覽
          </NavLink>
          <NavLink to="/favorites" className={({isActive}) => isActive ? 'btn-primary' : 'btn-ghost'}>
            收藏
          </NavLink>
          <NavLink to="/settings" className={({isActive}) => isActive ? 'btn-primary' : 'btn-ghost'}>
            設定
          </NavLink>
          <NavLink to="/faq" className={({isActive}) => isActive ? 'btn-primary' : 'btn-ghost'}>
            問與答
          </NavLink>
        </nav>
      </div>
    </header>
  );
}
