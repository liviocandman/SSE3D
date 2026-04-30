'use client';

// --- Types ---

export type ErrorType =
  // Legacy literal retained for compatibility with existing error contracts.
  // Upstream ephemeris is SPICE-kernel-based, not Horizons-only.
  | 'NASA_API_ERROR'
  | 'NETWORK_ERROR'
  | 'VALIDATION_ERROR'
  | 'TIMEOUT_ERROR'
  | 'WEBGL_NOT_SUPPORTED'
  | 'WEBGL_CONTEXT_LOST'
  | 'TEXTURE_LOAD_ERROR'
  | 'UNKNOWN_ERROR';

export interface AppError {
  type: ErrorType;
  message: string;
  technicalDetails?: string;
  canRetry: boolean;
}

interface ErrorOverlayProps {
  error: AppError;
  onRetry?: () => void;
  retryCount?: number;
  maxRetries?: number;
  isFallbackActive?: boolean;
}

// --- Error Messages ---

const ERROR_MESSAGES: Record<ErrorType, { title: string; description: string; icon: string }> = {
  NASA_API_ERROR: {
    title: 'EPHEMERIS API ERROR',
    description: 'Unable to fetch orbital data from the ephemeris upstream service.',
    icon: '🛰️',
  },
  NETWORK_ERROR: {
    title: 'Network Error',
    description: 'Unable to connect to the server. Please check your internet connection.',
    icon: '📡',
  },
  VALIDATION_ERROR: {
    title: 'Data Validation Error',
    description: 'The data received from the server was invalid or corrupted.',
    icon: '⚠️',
  },
  TIMEOUT_ERROR: {
    title: 'Request Timeout',
    description: 'The server took too long to respond. Please try again.',
    icon: '⏱️',
  },
  WEBGL_NOT_SUPPORTED: {
    title: 'WebGL Not Supported',
    description: 'Your browser does not support WebGL, which is required for 3D rendering.',
    icon: '🖥️',
  },
  WEBGL_CONTEXT_LOST: {
    title: 'Graphics Context Lost',
    description: 'The 3D rendering context was lost. This can happen due to GPU memory issues.',
    icon: '⚠️',
  },
  TEXTURE_LOAD_ERROR: {
    title: 'Texture Load Error',
    description: 'Some planet textures could not be loaded. The scene may appear incomplete.',
    icon: '🎨',
  },
  UNKNOWN_ERROR: {
    title: 'Unknown Error',
    description: 'An unexpected error occurred. Please try again or refresh the page.',
    icon: '❌',
  },
};

// --- Component ---

export function ErrorOverlay({
  error,
  onRetry,
  retryCount = 0,
  maxRetries = 3,
  isFallbackActive = false,
}: ErrorOverlayProps) {
  const errorInfo = ERROR_MESSAGES[error.type] || ERROR_MESSAGES.UNKNOWN_ERROR;
  const canRetry = error.canRetry && retryCount < maxRetries;
  const isWebGLError = error.type === 'WEBGL_NOT_SUPPORTED' || error.type === 'WEBGL_CONTEXT_LOST';

  const handleReload = () => {
    window.location.reload();
  };

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-6 bg-[#020617]/90 backdrop-blur-xl transition-all duration-700">{/* overlayStyle */}
      <div className="max-w-md w-full glass-panel p-10 rounded-3xl text-center border border-red-500/20 shadow-xl shadow-red-500/10">{/* cardStyle */}
        {/* Fallback mode badge */}
        <div className={`overflow-hidden transition-all duration-500 mb-8 ${isFallbackActive ? 'h-10 opacity-100' : 'h-0 opacity-0'}`}>
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-yellow-500/10 border border-yellow-500/20 rounded-full text-xs font-bold text-yellow-500 uppercase tracking-widest animate-pulse">{/* badgeStyle */}
            <span>⚠️</span>
            <span>Fallback Mode Active</span>
          </div>
        </div>

        {/* Error icon */}
        <div className="text-6xl mb-6 hardware-accel animate-bounce duration-[2000ms]">{/* iconStyle */}
          {errorInfo.icon}
        </div>

        {/* Title */}
        <h2 className="text-xl font-bold text-white tracking-[0.2em] uppercase mb-4">{/* titleStyle */}
          {errorInfo.title}
        </h2>

        {/* Description */}
        <p className="text-sm font-medium text-white/50 leading-relaxed mb-10">{/* descriptionStyle */}
          {errorInfo.description}
        </p>

        {/* Action buttons */}
        <div className="flex flex-col gap-4">
          {isWebGLError ? (
            <button
              className="w-full py-3.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold tracking-widest uppercase text-xs transition-all duration-300 shadow-lg shadow-blue-500/20 active:scale-95"
              /* buttonStyle */
              onClick={handleReload}
            >
              System Reboot
            </button>
          ) : (
            <>
              {error.canRetry && (
                <button
                  className={`w-full py-3.5 rounded-xl font-bold tracking-widest uppercase text-xs transition-all duration-300 active:scale-95 ${canRetry
                    ? 'bg-white text-black hover:bg-white/90 shadow-lg shadow-white/10' /* buttonStyle */
                    : 'bg-white/5 text-white/20 border border-white/5 cursor-not-allowed' /* buttonDisabledStyle */
                    }`}
                  onClick={canRetry ? onRetry : undefined}
                  disabled={!canRetry}
                >
                  {canRetry ? 'Re-attempt Link' : 'Retries Exhausted'}
                </button>
              )}
              <button
                className="w-full py-3.5 bg-white/5 hover:bg-white/10 border border-white/10 text-white rounded-xl font-bold tracking-widest uppercase text-xs transition-all duration-300 active:scale-95"
                /* secondaryButtonStyle */
                onClick={handleReload}
              >
                Manual Refresh
              </button>
            </>
          )}
        </div>

        {/* Retry count info */}
        <div className={`overflow-hidden transition-all duration-300 mt-6 ${error.canRetry && retryCount > 0 ? 'h-5 opacity-100' : 'h-0 opacity-0'}`}>
          <p className="text-[10px] font-bold text-white/20 uppercase tracking-[0.2em]">{/* retryInfoStyle */}
            Attempt {retryCount} of {maxRetries}
          </p>
        </div>

        {/* Technical details */}
        {error.technicalDetails && (
          <div className="mt-10 p-4 bg-black/40 rounded-xl border border-white/5 text-left group">
            <div className="text-[9px] font-bold text-white/20 uppercase tracking-widest mb-2 group-hover:text-white/40 transition-colors uppercaseTracking">{/* technicalStyle label */}
              Technical Logs
            </div>
            <div className="text-[10px] font-mono text-white/30 truncate group-hover:whitespace-normal transition-all duration-300">{/* technicalStyle content */}
              {error.technicalDetails}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
