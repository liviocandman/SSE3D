/**
 * Client-side API utilities and constants.
 * This file should only contain paths relative to the BFF (Next.js),
 * never the direct Python backend URL.
 */

// Add common client-side relative paths here if needed
export const BFF_API_ROUTES = {
  EPHEMERIS: '/api/ephemeris',
  AI: '/api/ai',
  FAVORITES: '/api/favorites',
  MISSIONS: '/api/missions/artemis2',
} as const;
