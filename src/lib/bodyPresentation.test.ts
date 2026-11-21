import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { bodySelectionData, filterSceneIntersections } from './bodyPresentation';

function target(bodyId: string, kind: 'surface' | 'hitbox' | 'label', x = 0) {
  const object = new THREE.Object3D();
  object.position.x = x;
  object.userData = bodySelectionData(bodyId, kind);
  object.updateMatrixWorld();
  return object;
}

describe('body pointer ownership', () => {
  it('filters hidden labels and decoration before Fiber dispatch while retaining visible labels, surfaces, and hitboxes', () => {
    const hiddenLabel = target('301', 'label'); hiddenLabel.visible = false;
    const decoration = new THREE.Object3D();
    const visibleLabel = target('399', 'label');
    const surface = target('499', 'surface');
    const hitbox = target('401', 'hitbox');
    const items = [hiddenLabel, decoration, visibleLabel, surface, hitbox].map(object => ({ object, distance: 1 }));
    expect(filterSceneIntersections(items).map(item => item.object)).toEqual([visibleLabel, surface, hitbox]);
  });
});
