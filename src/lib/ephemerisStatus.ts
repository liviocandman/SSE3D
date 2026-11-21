import type { DataSource } from './types';

export const DEGRADED_EPHEMERIS_MESSAGE =
  'Algumas posições são calculadas pelo baricentro do sistema ou usam dados de referência de outra data.';

export function isFallbackSource(source: DataSource | null): boolean {
  return source === 'SPICE_AND_FALLBACK' || source === 'FALLBACK_DATASET';
}
