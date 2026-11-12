import type { DataSource } from './types';

export const DEGRADED_EPHEMERIS_MESSAGE =
  'Algumas posições usam dados de referência e podem não representar a data selecionada.';

export function isFallbackSource(source: DataSource | null): boolean {
  return source === 'SPICE_AND_FALLBACK' || source === 'FALLBACK_DATASET';
}
