'use client';

import {
  createContext,
  useContext,
  ReactNode,
  useMemo,
  useState,
} from 'react';

// --- Types ---

export type QualityTier = 'high' | 'mid' | 'low';

interface QualitySettings {
  tier: QualityTier;
  textureResolution: 4096 | 2048 | 1024;
  shadowsEnabled: boolean;
  shadowType: 'soft' | 'basic' | 'none';
  antialias: boolean;
  devicePixelRatio: number;
}

interface QualityTierContextValue {
  tier: QualityTier;
  settings: QualitySettings;
}

// --- Constants ---

const HIGH_TIER_SETTINGS: QualitySettings = {
  tier: 'high',
  textureResolution: 4096,
  shadowsEnabled: true,
  shadowType: 'soft',
  antialias: true,
  devicePixelRatio: 2,
};

const MID_TIER_SETTINGS: QualitySettings = {
  tier: 'mid',
  textureResolution: 2048,
  shadowsEnabled: true,
  shadowType: 'basic',
  antialias: true,
  devicePixelRatio: 1.5,
};

const LOW_TIER_SETTINGS: QualitySettings = {
  tier: 'low',
  textureResolution: 1024,
  shadowsEnabled: false,
  shadowType: 'none',
  antialias: false,
  devicePixelRatio: 1,
};

const SETTINGS_BY_TIER: Record<QualityTier, QualitySettings> = {
  high: HIGH_TIER_SETTINGS,
  mid: MID_TIER_SETTINGS,
  low: LOW_TIER_SETTINGS,
};

// --- Context ---

const QualityTierContext = createContext<QualityTierContextValue | null>(null);

// --- Helper Functions ---

function detectQualityTier(): QualityTier {
  if (typeof window === 'undefined') {
    return 'mid'; // Default for SSR
  }

  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const hardwareConcurrency = navigator.hardwareConcurrency || 2;
  const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;

  // Check for WebGL renderer info
  let gpuTier: QualityTier = 'mid';
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (gl && gl instanceof WebGLRenderingContext) {
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      if (debugInfo) {
        const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) as string;
        const rendererLower = renderer.toLowerCase();

        // High-end GPU detection
        if (
          rendererLower.includes('nvidia') ||
          rendererLower.includes('radeon') ||
          rendererLower.includes('apple m')
        ) {
          gpuTier = 'high';
        }
        // Low-end GPU detection
        else if (
          rendererLower.includes('intel') ||
          rendererLower.includes('mali') ||
          rendererLower.includes('adreno 5') // Older Adreno
        ) {
          gpuTier = 'low';
        }
      }
    }
  } catch (error) {
    console.warn('Could not detect GPU info:', error);
  }

  // Determine final tier based on all factors
  if (isMobile) {
    // Mobile devices: cap at mid, prefer low for older devices
    if (gpuTier === 'low' || hardwareConcurrency <= 4) {
      return 'low';
    }
    return 'mid';
  }

  // Desktop devices
  if (gpuTier === 'high' && hardwareConcurrency >= 8) {
    return 'high';
  }
  if (gpuTier === 'low' || (deviceMemory && deviceMemory < 4)) {
    return 'low';
  }

  return 'mid';
}

// --- Provider Component ---

interface QualityTierProviderProps {
  children: ReactNode;
}

export function QualityTierProvider({ children }: QualityTierProviderProps) {
  // Use state to ensure detection only happens once on client
  const [tier] = useState<QualityTier>(() => 
    typeof window === 'undefined' ? 'mid' : detectQualityTier()
  );

  const contextValue = useMemo(() => {
    if (typeof window !== 'undefined') {
      console.log(`[QualityTier] Detected tier: ${tier}`);
    }
    return {
      tier,
      settings: SETTINGS_BY_TIER[tier],
    };
  }, [tier]);

  return (
    <QualityTierContext.Provider value={contextValue}>
      {children}
    </QualityTierContext.Provider>
  );
}

// --- Hook ---

export function useQualityTier(): QualityTierContextValue {
  const context = useContext(QualityTierContext);
  if (!context) {
    throw new Error('useQualityTier must be used within a QualityTierProvider');
  }
  return context;
}
