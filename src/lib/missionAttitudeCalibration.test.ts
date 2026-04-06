import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ORION_MESH_TO_BODY_QUATERNION } from './missionAttitudeCalibration';

describe('ORION_MESH_TO_BODY_QUATERNION', () => {
  it('maps mesh longitudinal axis (+Y) to body forward axis (+X)', () => {
    const meshForward = new THREE.Vector3(0, 1, 0);
    const bodyForward = meshForward.applyQuaternion(ORION_MESH_TO_BODY_QUATERNION);

    expect(bodyForward.x).toBeCloseTo(1, 6);
    expect(bodyForward.y).toBeCloseTo(0, 6);
    expect(bodyForward.z).toBeCloseTo(0, 6);
  });

  it('keeps mesh +Z aligned with body +Z to avoid roll ambiguity', () => {
    const meshUp = new THREE.Vector3(0, 0, 1);
    const bodyUp = meshUp.applyQuaternion(ORION_MESH_TO_BODY_QUATERNION);

    expect(bodyUp.x).toBeCloseTo(0, 6);
    expect(bodyUp.y).toBeCloseTo(0, 6);
    expect(bodyUp.z).toBeCloseTo(1, 6);
  });
});

