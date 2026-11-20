import type * as THREE from 'three';

type SelectionKind = 'surface' | 'hitbox' | 'label';

export function bodySelectionData(bodyId: string, selectionKind: SelectionKind) {
  return { celestialBodyId: bodyId, selectionKind };
}

/** Fiber event filter: only selection geometry may claim a scene click. */
export function filterSceneIntersections<T extends { object: THREE.Object3D }>(items: T[]): T[] {
  return items.filter(({ object }) => isVisible(object)
    && typeof object.userData.celestialBodyId === 'string'
    && ['surface', 'hitbox', 'label'].includes(object.userData.selectionKind));
}

function isVisible(object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (!current.visible) return false;
    current = current.parent;
  }
  return true;
}
