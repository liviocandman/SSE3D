'use client';

import { Component, type ReactNode } from 'react';
import { ErrorOverlay, type AppError } from '@/components/ui/ErrorOverlay';

interface Props {
  children: ReactNode;
  onError?: (error: AppError) => void;
}
interface State { error: AppError | null }

/** R3F forwards errors from its scene tree to the surrounding React tree. */
export class SceneErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    const message = error instanceof Error ? error.message : String(error);
    return {
      error: {
        type: /texture|ktx2|basis|load|fetch/i.test(message) ? 'TEXTURE_LOAD_ERROR' : 'SCENE_RENDER_ERROR',
        message: 'The 3D scene could not be rendered',
        technicalDetails: message,
        // Reload also clears rejected useLoader cache entries.
        canRetry: false,
      },
    };
  }

  componentDidCatch() {
    if (this.state.error) this.props.onError?.(this.state.error);
  }

  render() {
    return this.state.error ? <ErrorOverlay error={this.state.error} /> : this.props.children;
  }
}
