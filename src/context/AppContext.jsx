import React, { createContext, useContext, useState, useEffect } from 'react';
import { api, authStorage } from '../api/client';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  // Theme state: dark (default) or light
  const [theme, setTheme] = useState(() => localStorage.getItem('pulsewatch_theme') || 'dark');
  
  // Auth state
  const [token, setToken] = useState(() => authStorage.getToken());
  const [user, setUser] = useState(() => authStorage.getUser());

  // Global Toasts
  const [toasts, setToasts] = useState([]);

  // Command palette state
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

  // Dev panel state
  const [isDevPanelOpen, setIsDevPanelOpen] = useState(false);

  // Global reachability state (error banner when backend fails)
  const [apiReachable, setApiReachable] = useState(true);

  // Auto-refresh pause toggle
  const [isAutoRefreshPaused, setIsAutoRefreshPaused] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('pulsewatch_theme', theme);
  }, [theme]);

  // Global shortcut listeners: Ctrl+K / Cmd+K (Palette) & Ctrl+Shift+D (Dev Panel)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        setIsDevPanelOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  const addToast = (message, type = 'info', durationMs = 4000) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const newToast = { id, message, type };
    setToasts((prev) => [...prev, newToast]);

    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, durationMs);
  };

  const removeToast = (id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const loginUser = (authResult) => {
    authStorage.setToken(authResult.token);
    authStorage.setUser(authResult.user);
    setToken(authResult.token);
    setUser(authResult.user);
  };

  const logoutUser = () => {
    authStorage.clearToken();
    sessionStorage.removeItem('pulsewatch_user');
    setToken(null);
    setUser(null);
    window.location.hash = '#/login';
  };

  return (
    <AppContext.Provider
      value={{
        theme,
        toggleTheme,
        token,
        user,
        loginUser,
        logoutUser,
        toasts,
        addToast,
        removeToast,
        isCommandPaletteOpen,
        setIsCommandPaletteOpen,
        isDevPanelOpen,
        setIsDevPanelOpen,
        apiReachable,
        setApiReachable,
        isAutoRefreshPaused,
        setIsAutoRefreshPaused,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
