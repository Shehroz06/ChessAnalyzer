import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import { ThemeProvider, useTheme } from './context/ThemeContext.jsx';
import Home         from './pages/Home.jsx';
import AnalysisPage from './pages/AnalysisPage.jsx';
import PlayPage     from './pages/PlayPage.jsx';

function Navbar() {
  const { isLight, toggle } = useTheme();

  const link = ({ isActive }) =>
    `px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
      isActive
        ? 'bg-[var(--t-green)] text-white'
        : 'text-[var(--t-muted)] hover:text-[var(--t-text)] hover:bg-[var(--t-surf2)]'
    }`;

  return (
    <nav
      className="flex items-center gap-2 px-5 py-3 sticky top-0 z-50 border-b"
      style={{
        background:   'var(--t-surf)',
        borderColor:  'var(--t-border)',
      }}
    >
      {/* Brand */}
      <span className="text-xl select-none mr-1">♟</span>
      <span className="font-bold text-base mr-5 tracking-tight" style={{ color: 'var(--t-green)' }}>
        Chess Analyzer
      </span>

      {/* Links */}
      <NavLink to="/"     end className={link}>Home</NavLink>
      <NavLink to="/play"     className={link}>Play vs Computer</NavLink>

      {/* Theme toggle */}
      <button
        onClick={toggle}
        title={isLight ? 'Switch to Dark' : 'Switch to Light'}
        className="ml-auto w-9 h-9 flex items-center justify-center rounded-lg text-lg transition-colors"
        style={{
          background: 'var(--t-surf2)',
          color:      'var(--t-text2)',
        }}
      >
        {isLight ? '🌙' : '☀️'}
      </button>
    </nav>
  );
}

function AppInner() {
  return (
    <BrowserRouter>
      <div className="min-h-screen flex flex-col" style={{ background: 'var(--t-bg)' }}>
        <Navbar />
        <main className="flex-1">
          <Routes>
            <Route path="/"       element={<Home />} />
            <Route path="/analyze" element={<AnalysisPage />} />
            <Route path="/play"    element={<PlayPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppInner />
    </ThemeProvider>
  );
}
