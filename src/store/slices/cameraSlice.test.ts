import { beforeEach, describe, expect, it } from 'vitest';
import { useSolarStore } from '../solarStore';

describe('camera focus identity', () => {
  beforeEach(() => useSolarStore.setState(useSolarStore.getInitialState(), true));

  it('retains the origin body when travel is reset and another HUD body is selected', () => {
    const state = useSolarStore.getState();
    state.startOriginTravel({ x: 149600000, y: 0, z: 0 }, 1000, 0, '399');
    state.setFollowTarget('399');
    state.resetTravel(); state.stopOriginNavigation();
    state.setSelectedPlanet({ bodyId: '599', name: 'Júpiter', englishName: 'Jupiter' });
    expect(useSolarStore.getState()).toMatchObject({
      cameraFocusBodyId: '399', followTargetId: null, cameraNavMode: 'idle',
      selectedPlanet: { bodyId: '599' },
    });
  });

  it('updates the reference body for a new destination and restores the Sun on origin reset', () => {
    const state = useSolarStore.getState();
    expect(state.cameraFocusBodyId).toBe('10');
    state.startOriginTravel({ x: 1, y: 0, z: 0 }, 1000, 0, '301');
    expect(useSolarStore.getState().cameraFocusBodyId).toBe('301');
    state.startOriginTravel({ x: 2, y: 0, z: 0 }, 1000, 0);
    expect(useSolarStore.getState().cameraFocusBodyId).toBeNull();
    state.resetRenderOrigin();
    expect(useSolarStore.getState()).toMatchObject({ cameraFocusBodyId: '10', cameraNavMode: 'idle', followTargetId: null });
  });
});
