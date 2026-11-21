import { describe, expect, it } from 'vitest';
import { getBodyCameraFraming } from './cameraConfig';

describe('visual body camera clearance', () => {
  it.each(['399', '599', '699', '401', '402', '301'])('frames %s safely in both scale modes', id => {
    for (const mode of ['realistic', 'didactic'] as const) {
      const framing = getBodyCameraFraming(id, mode, 0.00001)!;
      expect(framing.minDistance - framing.radius).toBeGreaterThan(0.00001);
      expect(framing.distance).toBeGreaterThanOrEqual(framing.minDistance);
    }
  });
  it('does not invent a radius for an unknown target', () => {
    expect(getBodyCameraFraming('unknown', 'didactic')).toBeNull();
  });
});
