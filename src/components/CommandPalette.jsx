import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { api } from '../api/client';
import { Search, Monitor, AlertCircle, Cpu, Info, Sun, Moon, LogOut } from 'lucide-react';

export function CommandPalette() {
  const { isCommandPaletteOpen, setIsCommandPaletteOpen, theme, toggleTheme, logoutUser } = useApp();
  const [query, setQuery] = useState('');
  const [monitors, setMonitors] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    if (isCommandPaletteOpen) {
      setQuery('');
      setSelectedIndex(0);
      api.getMonitors().then(setMonitors).catch(() => {});
    }
  }, [isCommandPaletteOpen]);

  const navigationItems = [
    { label: 'Go to Dashboard', icon: Monitor, action: () => navigate('/dashboard') },
    { label: 'Go to Incident Log', icon: AlertCircle, action: () => navigate('/incidents') },
    { label: 'Go to System Reactor Panel', icon: Cpu, action: () => navigate('/system') },
    { label: 'Go to Architecture & Docs', icon: Info, action: () => navigate('/about') },
    { label: `Toggle Theme (${theme === 'dark' ? 'Light' : 'Dark'})`, icon: theme === 'dark' ? Sun : Moon, action: toggleTheme },
    { label: 'Sign Out Session', icon: LogOut, action: logoutUser },
  ];

  const filteredMonitors = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return monitors
      .filter((m) => m.name.toLowerCase().includes(q) || m.url.toLowerCase().includes(q))
      .map((m) => ({
        label: `${m.name} (${m.url})`,
        icon: Monitor,
        action: () => navigate(`/monitors/${m.id}`),
        tag: m.state,
      }));
  }, [query, monitors, navigate]);

  const allItems = useMemo(() => {
    if (!query.trim()) return navigationItems;
    const q = query.toLowerCase();
    const matchedNav = navigationItems.filter((item) => item.label.toLowerCase().includes(q));
    return [...filteredMonitors, ...matchedNav];
  }, [query, navigationItems, filteredMonitors]);

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % (allItems.length || 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + allItems.length) % (allItems.length || 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (allItems[selectedIndex]) {
        allItems[selectedIndex].action();
        setIsCommandPaletteOpen(false);
      }
    } else if (e.key === 'Escape') {
      setIsCommandPaletteOpen(false);
    }
  };

  if (!isCommandPaletteOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        backdropFilter: 'blur(8px)',
        zIndex: 3000,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '12vh',
        paddingLeft: '16px',
        paddingRight: '16px',
      }}
      onClick={() => setIsCommandPaletteOpen(false)}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '560px',
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-highlight)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: 'var(--shadow-card), 0 24px 48px rgba(0,0,0,0.8)',
          overflow: 'hidden',
          animation: 'slideUp 160ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '14px 18px',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <Search size={18} color="var(--text-muted)" />
          <input
            autoFocus
            type="text"
            placeholder="Type a command, monitor name, or URL..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            style={{
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--text-primary)',
              fontSize: '0.95rem',
              width: '100%',
              fontFamily: 'var(--font-sans)',
            }}
          />
          <kbd
            className="font-mono text-muted"
            style={{
              fontSize: '0.68rem',
              padding: '2px 6px',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            ESC
          </kbd>
        </div>

        <div style={{ maxHeight: '340px', overflowY: 'auto', padding: '6px' }}>
          {allItems.length === 0 ? (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              No results found for "{query}"
            </div>
          ) : (
            allItems.map((item, idx) => {
              const Icon = item.icon;
              const isSelected = selectedIndex === idx;

              return (
                <div
                  key={idx}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onClick={() => {
                    item.action();
                    setIsCommandPaletteOpen(false);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: isSelected ? 'var(--bg-surface-hover)' : 'transparent',
                    cursor: 'pointer',
                    transition: 'background var(--transition-fast)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <Icon size={16} color={isSelected ? 'var(--accent-cyan)' : 'var(--text-muted)'} />
                    <span
                      style={{
                        fontSize: '0.88rem',
                        color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)',
                      }}
                    >
                      {item.label}
                    </span>
                  </div>
                  {item.tag && (
                    <span
                      className="font-mono"
                      style={{
                        fontSize: '0.7rem',
                        padding: '2px 6px',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: 'var(--border-subtle)',
                        color: 'var(--text-muted)',
                      }}
                    >
                      {item.tag}
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
