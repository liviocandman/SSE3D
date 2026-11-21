import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { renderHook } from '@testing-library/react';
import { useCameraAnimation } from './useCameraAnimation';
import { useSolarStore, type SolarState } from '@/store/solarStore';
import { useThree, useFrame } from '@react-three/fiber';
import { resolveGeneralTargetFrame } from '@/lib/simulation/frameResolvers';
import { FRAME_PRIORITIES } from '@/lib/framePriorities';
import { getBodyCameraFraming } from '@/lib/cameraConfig';
import { getMoonOrbitScale } from '@/lib/scales';

vi.mock('@react-three/fiber', () => ({ useThree: vi.fn(), useFrame: vi.fn() }));
vi.mock('@/store/solarStore', () => ({ useSolarStore: { getState: vi.fn() } }));
vi.mock('@/lib/time/clockRuntime', () => ({ clockRuntime: { getTimeMs: vi.fn(() => 123456) } }));
vi.mock('@/lib/simulation/frameResolvers', () => ({ resolveGeneralTargetFrame: vi.fn(() => false) }));

describe('camera-relative navigation', () => {
  let camera: THREE.PerspectiveCamera;
  let state: SolarState;
  let controls: { target: THREE.Vector3; update: ReturnType<typeof vi.fn> };
  let nowMs: number;
  const frame = () => {
    const callback = vi.mocked(useFrame).mock.calls.at(-1)![0];
    callback({} as never, 1 / 60);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    nowMs = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
    camera = new THREE.PerspectiveCamera(45, 1, 0.00001, 50000);
    camera.position.set(0, 200, 500);
    controls = { target: new THREE.Vector3(1, 1, 1), update: vi.fn() };
    vi.mocked(useThree).mockReturnValue({ camera, controls } as never);
    state = {
      renderOrigin: { x: 0, y: 0, z: 0 },
      cameraNavMode: 'idle', followTargetId: null, viewMode: 'realistic', cameraFocusBodyId: '10',
      originStartKm: { x: 0, y: 0, z: 0 }, originTargetKm: { x: 0, y: 0, z: 0 },
      travelStartMs: 0, travelDurationMs: 0,
      setRenderOrigin: vi.fn<SolarState['setRenderOrigin']>((position) => { state.renderOrigin = position; }),
      setCameraFocusBody: vi.fn<SolarState['setCameraFocusBody']>(id => { state.cameraFocusBodyId = id; }),
      startOriginTravel: vi.fn<SolarState['startOriginTravel']>((target, duration, start, id) => {
        state.originStartKm = { ...state.renderOrigin }; state.originTargetKm = target;
        state.travelDurationMs = duration; state.travelStartMs = start;
        state.followTargetId = id ?? null; state.cameraNavMode = 'travel';
        state.cameraFocusBodyId = id ?? null;
      }),
      setFollowTarget: vi.fn<SolarState['setFollowTarget']>(id => { state.followTargetId = id; state.cameraFocusBodyId = id; state.cameraNavMode = 'follow'; }),
      stopOriginNavigation: vi.fn(() => { state.cameraNavMode = 'idle'; state.followTargetId = null; }),
    } as unknown as SolarState;
    vi.mocked(useSolarStore.getState).mockReturnValue(state);
    vi.mocked(resolveGeneralTargetFrame).mockImplementation(() => false);
  });
  afterEach(() => vi.restoreAllMocks());

  it('starts a smooth zoom instead of teleporting the camera to the close-up', () => {
    const { result } = renderHook(() => useCameraAnimation());
    const initialDistance = camera.position.length();
    result.current.focusOn({ x: 149600000, y: 0, z: 0 }, 6371, '399');
    expect(camera.position.length()).toBe(initialDistance);
    const duration = state.travelDurationMs;
    nowMs += duration / 2; frame();
    const midpoint = camera.position.length();
    expect(midpoint).toBeLessThan(initialDistance);
    expect(midpoint).toBeGreaterThan(getBodyCameraFraming('399', 'realistic')!.distance);
    nowMs += duration / 2; frame();
    expect(camera.position.length()).toBeCloseTo(getBodyCameraFraming('399', 'realistic')!.distance, 8);
  });

  it.each(['399', '599', '699', '401'])('keeps %s outside the camera when switching scale in a close-up', (bodyId) => {
    const { result } = renderHook(() => useCameraAnimation());
    result.current.focusOn({ x: 100000000, y: 0, z: 0 }, undefined, bodyId);
    nowMs += state.travelDurationMs; frame();
    const realistic = getBodyCameraFraming(bodyId, 'realistic')!;
    const beforeRatio = camera.position.length() / realistic.radius;
    state.viewMode = 'didactic'; frame();
    const didactic = getBodyCameraFraming(bodyId, 'didactic')!;
    expect(camera.position.length()).toBeGreaterThan(didactic.radius);
    expect(camera.position.length() / didactic.radius).toBeCloseTo(beforeRatio, 6);
    state.viewMode = 'realistic'; frame();
    expect(camera.position.length()).toBeCloseTo(realistic.distance, 8);
  });

  it('enforces clearance even after a user zooms through the selected surface', () => {
    state.cameraNavMode = 'follow'; state.followTargetId = '399';
    renderHook(() => useCameraAnimation());
    camera.position.set(0, 0, 0); frame();
    expect(camera.position.length()).toBeCloseTo(getBodyCameraFraming('399', 'realistic')!.minDistance, 8);
  });

  it('updates origin from the current target sample before the body stage', () => {
    state.cameraNavMode = 'follow'; state.followTargetId = '399';
    vi.mocked(resolveGeneralTargetFrame).mockImplementation((_id, time, out) => {
      expect(time).toBe(123456); out.set(149600123, 450, -1234); return true;
    });
    renderHook(() => useCameraAnimation()); frame();
    expect(vi.mocked(useFrame).mock.calls.at(-1)![1]).toBe(FRAME_PRIORITIES.ORIGIN);
    expect(FRAME_PRIORITIES.CLOCK).toBeLessThan(FRAME_PRIORITIES.ORIGIN);
    expect(FRAME_PRIORITIES.ORIGIN).toBeLessThan(FRAME_PRIORITIES.CONTROLS);
    expect(FRAME_PRIORITIES.CONTROLS).toBeLessThan(FRAME_PRIORITIES.BODIES);
    expect(state.renderOrigin).toEqual({ x: 149600123, y: 450, z: -1234 });
  });

  it('finishes travel at a moving target instead of jumping from the old endpoint on follow', () => {
    const { result } = renderHook(() => useCameraAnimation());
    result.current.focusOn({ x: 149600000, y: 0, z: 0 }, undefined, '399');
    vi.mocked(resolveGeneralTargetFrame).mockImplementation((_id, _time, out) => { out.set(149700000, 20, -100); return true; });
    nowMs += state.travelDurationMs; frame();
    expect(state.renderOrigin).toEqual({ x: 149700000, y: 20, z: -100 });
    frame();
    expect(state.renderOrigin).toEqual({ x: 149700000, y: 20, z: -100 });
  });

  it('centers the displayed moon when the didactic mode expands its orbit', () => {
    state.cameraNavMode = 'follow'; state.followTargetId = '301'; state.viewMode = 'didactic';
    vi.mocked(resolveGeneralTargetFrame).mockImplementation((id, _time, out) => {
      out.set(id === '301' ? 149984400 : 149600000, 0, 0); return true;
    });
    renderHook(() => useCameraAnimation()); frame();
    const orbitScale = getMoonOrbitScale('399', 'ROCKY_PLANET', 0.00257 * 149_597_870.7, 'didactic');
    expect(state.renderOrigin.x).toBeCloseTo(149600000 + 384400 * orbitScale, 2);
  });

  it('does not change orbital distance merely because a planet is selected', () => {
    state.selectedPlanet = { bodyId: '599', name: 'Júpiter', englishName: 'Jupiter' };
    renderHook(() => useCameraAnimation());
    const initial = camera.position.clone(); frame();
    expect(camera.position).toEqual(initial);
  });

  it('retains Earth clearance and scale framing after a single click stops tracking', () => {
    const { result } = renderHook(() => useCameraAnimation());
    result.current.focusOn({ x: 149600000, y: 0, z: 0 }, undefined, '399');
    nowMs += state.travelDurationMs; frame();
    result.current.stopTracking();
    state.selectedPlanet = { bodyId: '599', name: 'Júpiter', englishName: 'Jupiter' };
    expect(state.followTargetId).toBeNull();
    expect(state.cameraFocusBodyId).toBe('399');
    state.viewMode = 'didactic'; frame();
    expect(camera.position.length()).toBeCloseTo(getBodyCameraFraming('399', 'didactic')!.distance, 8);
    expect(camera.position.length()).toBeGreaterThan(getBodyCameraFraming('399', 'didactic')!.radius);
    expect(state.renderOrigin).toEqual({ x: 149600000, y: 0, z: 0 });
    camera.position.set(0, 0, 0); frame();
    expect(camera.position.length()).toBeCloseTo(getBodyCameraFraming('399', 'didactic')!.minDistance, 8);
  });

  it('releases the old focus when the body has moved away from the stopped origin', () => {
    state.cameraFocusBodyId = '399';
    state.renderOrigin = { x: 149600000, y: 0, z: 0 };
    vi.mocked(resolveGeneralTargetFrame).mockImplementation((_id, _time, out) => { out.set(150600000, 0, 0); return true; });
    renderHook(() => useCameraAnimation());
    camera.position.set(0, 0, 0.1115); frame();
    expect(state.cameraFocusBodyId).toBeNull();
    state.viewMode = 'didactic'; frame();
    expect(camera.position.length()).toBeCloseTo(0.1115, 8);
  });

  it('keeps the stopped camera outside a body that moves away from the frozen origin', () => {
    state.cameraFocusBodyId = '399';
    state.renderOrigin = { x: 149600000, y: 0, z: 0 };
    vi.mocked(resolveGeneralTargetFrame).mockImplementation((_id, _time, out) => { out.set(149600000, 0, 50000); return true; });
    renderHook(() => useCameraAnimation());
    camera.position.set(0, 0, 0.05); frame();
    const currentBodyCenter = new THREE.Vector3(0, 0, 0.05);
    expect(camera.position.distanceTo(currentBodyCenter)).toBeCloseTo(getBodyCameraFraming('399', 'realistic')!.minDistance, 8);
    expect(state.renderOrigin).toEqual({ x: 149600000, y: 0, z: 0 });
    expect(state.cameraNavMode).toBe('idle');
  });

  it('rebases a stopped moon focus when its displayed orbit changes scale', () => {
    vi.mocked(resolveGeneralTargetFrame).mockImplementation((id, _time, out) => {
      out.set(id === '301' ? 149984400 : 149600000, 0, 0); return true;
    });
    const { result } = renderHook(() => useCameraAnimation());
    result.current.focusOn({ x: 149984400, y: 0, z: 0 }, undefined, '301');
    nowMs += state.travelDurationMs; frame();
    result.current.stopTracking(); state.viewMode = 'didactic'; frame();
    const orbitScale = getMoonOrbitScale('399', 'ROCKY_PLANET', 0.00257 * 149_597_870.7, 'didactic');
    expect(state.renderOrigin.x).toBeCloseTo(149600000 + 384400 * orbitScale, 2);
    expect(state.cameraNavMode).toBe('idle');
    expect(camera.position.length()).toBeCloseTo(getBodyCameraFraming('301', 'didactic')!.distance, 8);
  });

  it('protects the global Sun without moving the initial view or zooming through its scale transition', () => {
    state.viewMode = 'didactic';
    const initial = camera.position.clone();
    renderHook(() => useCameraAnimation()); frame();
    expect(camera.position).toEqual(initial);
    state.viewMode = 'realistic'; frame();
    expect(camera.position).toEqual(initial);
    camera.position.set(0, 0, 0.00001); frame();
    expect(camera.position.length()).toBeCloseTo(getBodyCameraFraming('10', 'realistic')!.minDistance, 8);
    state.viewMode = 'didactic'; frame();
    expect(camera.position.length()).toBeGreaterThan(getBodyCameraFraming('10', 'didactic')!.radius);
  });

  it('supports stopping and returning the origin to the Sun', () => {
    const { result } = renderHook(() => useCameraAnimation());
    result.current.stopTracking(); expect(state.stopOriginNavigation).toHaveBeenCalled();
    result.current.resetCamera();
    expect(state.startOriginTravel).toHaveBeenCalledWith({ x: 0, y: 0, z: 0 }, 2000, nowMs);
  });

  it('keeps the orbit-controls target at the render origin', () => {
    renderHook(() => useCameraAnimation()); frame();
    expect(controls.target.toArray()).toEqual([0, 0, 0]);
    expect(controls.update).toHaveBeenCalled();
  });
});
