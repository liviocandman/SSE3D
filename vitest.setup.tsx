import '@testing-library/jest-dom';
import type React from 'react';
import { vi } from 'vitest';

// Fix for Next.js 15+ navigation/router in tests
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
  }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

// Polyfill for process.env and internal Next.js config access
if (typeof process !== 'undefined') {
  process.env = process.env || {};
  // @ts-expect-error - internal config is not in standard types
  process.env.config = process.env.config || {};
}


// Fix for Zustand v5 shallow imports in tests
vi.mock('zustand/react/shallow', () => ({
  useShallow: (val: unknown) => val,
}));

// Fix for components or libraries that might depend on Next.js config
vi.mock('next/config', () => {
  const config = {
    publicRuntimeConfig: {},
    serverRuntimeConfig: {},
  };
  return {
    default: () => config,
    getConfig: () => config,
  };
});


// Extremely aggressive mock for internal Next.js config access
vi.mock('next/dist/server/config-shared', () => ({
  default: {
    config: {},
  },
}));

// Fix for Auth.js (next-auth v5) core in tests
vi.mock('next-auth', () => ({
  default: vi.fn(),
  handlers: vi.fn(),
  auth: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

// Fix for Auth.js (next-auth v5) in tests
vi.mock('next-auth/react', () => ({
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
  useSession: () => ({
    data: null,
    status: 'unauthenticated',
  }),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

// Polyfill for Request/Response if missing in jsdom
if (typeof global.Request === 'undefined') {
  // @ts-expect-error - polyfilling global
  global.Request = class {};
}
if (typeof global.Response === 'undefined') {
  // @ts-expect-error - polyfilling global
  global.Response = class {};
}

// Mock Web Worker
if (typeof global.Worker === 'undefined') {
  // @ts-expect-error - polyfilling global
  global.Worker = class {
    onmessage: ((ev: MessageEvent<unknown>) => void) | null = null;
    postMessage(message: unknown) { void message; }
    terminate() {}
    addEventListener(type: string, listener: EventListenerOrEventListenerObject) { void type; void listener; }
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject) { void type; void listener; }
  };
}
