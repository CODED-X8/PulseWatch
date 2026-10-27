import React from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { ToastContainer } from './ToastContainer';
import { CommandPalette } from './CommandPalette';
import { DevPanel } from './DevPanel';
import { EventTicker } from './EventTicker';
import {
  Activity,
  LayoutDashboard,
  AlertTriangle,
  Cpu,
  Info,
  Sun,
  Moon,
  Command,
  LogOut,
  AlertOctagon,
  Terminal,
} from 'lucide-react';

export function AppLayout() {
  const { theme, toggleTheme, user, logoutUser, setIsCommandPaletteOpen, setIsDevPanelOpen, apiReachable } = useApp();
  const location = useLocation();

  const navItems = [
    { to: '/dashboard', label: 'Monitors', icon: LayoutDashboard },
    { to: '/incidents', label: 'Incidents', icon: AlertTriangle },
    { to: '/system', label: 'Reactor Panel', icon: Cpu },
    { to: '/about', label: 'Architecture', icon: Info },
  ];

  return (
    <div className="app-shell" style={{ display: 'flex', minHeight: '100vh', width: '100%' }}>
      {/* Global unreachable backend banner */}
      {!apiReachable && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 9999,
            backgroundColor: 'var(--status-down)',
            color: '#ffffff',
            padding: '8px 16px',
            fontSize: '0.8rem',
            fontWeight: 600,
            textAlign: 'center',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
          }}
        >
          <AlertOctagon size={16} />
          API connection degraded or unreachable. Displaying cached local telemetry.
        </div>
      )}

      {/* Desktop Sidebar (Left) */}
      <aside className="app-sidebar">
        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 4px' }}>
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--accent-gradient)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: 'var(--shadow-glow)',
            }}
          >
            <Activity size={18} color="#ffffff" />
          </div>
          <div>
            <div style={{ fontSize: '0.98rem', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
              PulseWatch
            </div>
            <div style={{ fontSize: '0.65rem', color: 'var(--accent-cyan)', fontWeight: 600, letterSpacing: '0.04em' }}>
              HIGH-PRECISION SRE
            </div>
          </div>
        </div>

        {/* Navigation links */}
        <nav style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '16px', flex: 1 }}>
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname.startsWith(item.to);

            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={`nav-item ${isActive ? 'active' : ''}`}
              >
                <Icon size={16} />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        {/* Quick action bar in sidebar footer */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingTop: '16px', borderTop: '1px solid var(--border-subtle)' }}>
          <button
            onClick={() => setIsCommandPaletteOpen(true)}
            className="sidebar-quick-btn"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '6px 10px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--bg-surface-elevated)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-secondary)',
              fontSize: '0.75rem',
              cursor: 'pointer',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Command size={13} />
              <span>Palette</span>
            </div>
            <kbd className="font-mono" style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Ctrl+K</kbd>
          </button>

          <button
            onClick={() => setIsDevPanelOpen(true)}
            className="sidebar-quick-btn"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '6px 10px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'rgba(99, 102, 241, 0.1)',
              border: '1px solid rgba(99, 102, 241, 0.25)',
              color: 'var(--accent-cyan)',
              fontSize: '0.75rem',
              cursor: 'pointer',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Terminal size={13} />
              <span>Dev Chaos</span>
            </div>
            <kbd className="font-mono" style={{ fontSize: '0.65rem' }}>Ctrl+⇧+D</kbd>
          </button>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '10px' }}>
            <button
              onClick={toggleTheme}
              aria-label="Toggle theme"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                padding: '6px',
                borderRadius: 'var(--radius-sm)',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>

            {user && (
              <button
                onClick={logoutUser}
                title="Sign out"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: '6px',
                  borderRadius: 'var(--radius-sm)',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <LogOut size={16} />
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="app-main-viewport" style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Top Header Bar */}
        <header className="app-topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <EventTicker />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '4px 10px',
                backgroundColor: 'var(--bg-surface-elevated)',
                borderRadius: 'var(--radius-full)',
                border: '1px solid var(--border-subtle)',
                fontSize: '0.75rem',
              }}
            >
              <div
                style={{
                  width: '7px',
                  height: '7px',
                  borderRadius: '50%',
                  backgroundColor: 'var(--status-up)',
                  boxShadow: '0 0 6px var(--status-up)',
                }}
              />
              <span className="font-mono" style={{ color: 'var(--text-secondary)' }}>ap-south-1</span>
            </div>

            {user && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '0.8rem',
                  color: 'var(--text-secondary)',
                }}
              >
                <div
                  style={{
                    width: '26px',
                    height: '26px',
                    borderRadius: '50%',
                    backgroundColor: 'var(--bg-surface-elevated)',
                    border: '1px solid var(--border-highlight)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 600,
                    fontSize: '0.75rem',
                    color: 'var(--text-primary)',
                  }}
                >
                  {user.email ? user.email.substring(0, 2).toUpperCase() : 'PW'}
                </div>
              </div>
            )}
          </div>
        </header>

        {/* Page Views Render Slot */}
        <main style={{ flex: 1, padding: '24px 28px', maxWidth: '1440px', width: '100%', margin: '0 auto' }}>
          <Outlet />
        </main>
      </div>

      {/* Mobile Bottom Tab Bar */}
      <nav className="mobile-tab-bar">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname.startsWith(item.to);

          return (
            <NavLink
              key={item.to}
              to={item.to}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '4px',
                textDecoration: 'none',
                color: isActive ? 'var(--accent-cyan)' : 'var(--text-muted)',
                fontSize: '0.68rem',
                fontWeight: isActive ? 600 : 400,
              }}
            >
              <Icon size={18} />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      {/* Floating Systems */}
      <ToastContainer />
      <CommandPalette />
      <DevPanel />
    </div>
  );
}
