import '@testing-library/jest-dom';
import React from 'react';
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
  // @ts-ignore
  process.env = process.env || {};
  // @ts-ignore
  process.env.config = process.env.config || {};
}


// Fix for Zustand v5 shallow imports in tests
vi.mock('zustand/react/shallow', () => ({
  useShallow: (val: any) => val,
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

// Global Framer Motion mock using React.createElement for maximum compatibility
vi.mock('framer-motion', () => {
  const mockComponent = (tag: string) => {
    const Component = ({ children, ...props }: any) => {
      // Filter out framer-motion specific props that might cause warnings on HTML elements
      const { 
        animate, initial, exit, transition, variants, 
        onAnimationComplete, onAnimationStart, 
        viewport, whileInView, whileHover, whileTap,
        ...htmlProps 
      } = props;
      return React.createElement(tag, htmlProps, children);
    };
    Component.displayName = `mock.motion.${tag}`;
    return Component;
  };

  return {
    motion: {
      div: mockComponent('div'),
      span: mockComponent('span'),
      section: mockComponent('section'),
      nav: mockComponent('nav'),
      button: mockComponent('button'),
      h1: mockComponent('h1'),
      h2: mockComponent('h2'),
      h3: mockComponent('h3'),
      p: mockComponent('p'),
      a: mockComponent('a'),
    },
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
    useReducedMotion: () => false,
    useAnimation: () => ({
      start: vi.fn(),
      stop: vi.fn(),
    }),
  };
});

// Polyfill for Request/Response if missing in jsdom
if (typeof global.Request === 'undefined') {
  // @ts-ignore
  global.Request = class {};
}
if (typeof global.Response === 'undefined') {
  // @ts-ignore
  global.Response = class {};
}