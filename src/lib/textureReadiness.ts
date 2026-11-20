const ESSENTIAL_TEXTURE_IDS = ['10', '199', '299', '399', '499', '599', '699', '799', '899'];
const loaded = new Set<string>();
const listeners = new Set<() => void>();

export function markEssentialTextureReady(bodyId: string): void {
  if (!ESSENTIAL_TEXTURE_IDS.includes(bodyId) || loaded.has(bodyId)) return;
  loaded.add(bodyId);
  for (const listener of listeners) listener();
}

export function getEssentialTextureIds(bodyIds?: readonly string[]): readonly string[] {
  if (!bodyIds) return ESSENTIAL_TEXTURE_IDS;
  return ESSENTIAL_TEXTURE_IDS.filter(id => id === '10' || bodyIds.includes(id));
}

export function getTextureReadiness(requiredIds: readonly string[]): number {
  return requiredIds.filter(id => loaded.has(id)).length;
}

export function subscribeTextureReadiness(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
