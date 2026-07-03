'use client';

import { useState, useEffect, useCallback } from 'react';

const APP_KEY_STORAGE_KEY = 'narratorai_app_key';

export function useAppKey() {
  const [appKey, setAppKeyState] = useState<string>('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(APP_KEY_STORAGE_KEY) || '';
    setAppKeyState(stored);
    setLoaded(true);
  }, []);

  const setAppKey = useCallback((key: string) => {
    const trimmed = key.trim();
    if (trimmed) {
      localStorage.setItem(APP_KEY_STORAGE_KEY, trimmed);
    } else {
      localStorage.removeItem(APP_KEY_STORAGE_KEY);
    }
    setAppKeyState(trimmed);
  }, []);

  const clearAppKey = useCallback(() => {
    localStorage.removeItem(APP_KEY_STORAGE_KEY);
    setAppKeyState('');
  }, []);

  return { appKey, setAppKey, clearAppKey, loaded };
}
