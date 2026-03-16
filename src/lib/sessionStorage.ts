/**
 * Helper functions for safely interacting with sessionStorage.
 * Prevents Next.js SSR errors by checking for window.
 */

export function getSessionItem<T>(key: string, defaultValue: T): T {
  if (typeof window === 'undefined') {
    return defaultValue;
  }

  try {
    const item = window.sessionStorage.getItem(key);
    return item ? JSON.parse(item) : defaultValue;
  } catch (error) {
    console.error(`[SessionStorage] Error reading key "${key}":`, error);
    return defaultValue;
  }
}

export function setSessionItem<T>(key: string, value: T): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const serialized = JSON.stringify(value);
    window.sessionStorage.setItem(key, serialized);
  } catch (error) {
    console.error(`[SessionStorage] Error saving key "${key}":`, error);
  }
}

export function removeSessionItem(key: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.sessionStorage.removeItem(key);
  } catch (error) {
    console.error(`[SessionStorage] Error removing key "${key}":`, error);
  }
}
