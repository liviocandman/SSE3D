'use client';

import { useMemo } from 'react';
import { useMissionStore } from '@/store/missionStore';
import { useShallow } from 'zustand/react/shallow';
import { SpacecraftBody } from './SpacecraftBody';
import { MissionTrajectoryLine } from './MissionTrajectoryLine';
import { MissionMilestoneMarker } from './MissionMilestoneMarker';
import { MissionPhase } from '@/lib/missionTypes';
import { MISSION_CONFIG } from '@/lib/types';
import type { EphemerisData, SelectedPlanet } from '@/lib/types';

interface EarthMissionLayerProps {
  earthSelectionContext: SelectedPlanet | null;
  earthEphemeris: EphemerisData | null;
  isEarthMissionContextActive: boolean;
  setSelectedPlanet: (planet: SelectedPlanet | null) => void;
}

export function EarthMissionLayer({
  earthSelectionContext,
  earthEphemeris,
  isEarthMissionContextActive,
  setSelectedPlanet,
}: EarthMissionLayerProps) {
  const {
    missionState,
    missionTrajectory,
    missionEvents,
    estimatedAttitudeEnabled,
    selectedMissionTargetId,
    setSelectedMissionTargetId,
  } = useMissionStore(
    useShallow((state) => ({
      missionState: state.missionState,
      missionTrajectory: state.missionTrajectory,
      missionEvents: state.missionEvents,
      estimatedAttitudeEnabled: state.estimatedAttitudeEnabled,
      selectedMissionTargetId: state.selectedMissionTargetId,
      setSelectedMissionTargetId: state.setSelectedMissionTargetId,
    }))
  );

  const missionMilestones = useMemo(() => {
    if (!missionEvents?.events || !missionTrajectory) return [];

    const majorPhases = [
      MissionPhase.EARTH_DEPARTURE,
      MissionPhase.LUNAR_FLYBY,
      MissionPhase.REENTRY,
    ];

    const allTrajectoryPoints = [...missionTrajectory.past, ...missionTrajectory.planned];

    return missionEvents.events
      .filter((ev) => majorPhases.includes(ev.phase))
      .map((ev) => {
        const evDate = new Date(ev.timestamp).getTime();
        if (!Number.isFinite(evDate)) return null;
        let nearestPoint = allTrajectoryPoints[0];
        let minDiff = Infinity;

        for (const pt of allTrajectoryPoints) {
          const ptDate = new Date(pt.timestamp).getTime();
          if (!Number.isFinite(ptDate)) continue;
          const diff = Math.abs(evDate - ptDate);
          if (diff < minDiff) {
            minDiff = diff;
            nearestPoint = pt;
          }
        }

        if (!nearestPoint) return null;

        const pos: [number, number, number] = [
          nearestPoint.position.x,
          nearestPoint.position.y,
          nearestPoint.position.z,
        ];

        return {
          id: ev.id,
          label: ev.name,
          position: pos,
        };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);
  }, [missionEvents, missionTrajectory]);

  if (!missionState || !isEarthMissionContextActive) {
    return null;
  }

  return (
    <>
      <SpacecraftBody
        vehicleId={missionState.vehicleId}
        label={missionState.vehicleId === 'orion' ? 'Orion' : missionState.vehicleId.toUpperCase()}
        isSelected={selectedMissionTargetId === missionState.vehicleId}
        attitudeQuaternion={missionState.attitudeQuaternion}
        earthEphemeris={earthEphemeris}
        onClick={(id) => {
          if (earthSelectionContext) {
            setSelectedPlanet(earthSelectionContext);
          }
          setSelectedMissionTargetId(id);
        }}
        onDoubleClick={(id) => {
          if (earthSelectionContext) {
            setSelectedPlanet(earthSelectionContext);
          }
          setSelectedMissionTargetId(id);
        }}
        useAttitude={
          MISSION_CONFIG.ENABLE_ATTITUDE &&
          (missionState.attitudeSource === 'CK_SPICE' ||
            (MISSION_CONFIG.ENABLE_POLICY_ATTITUDE && estimatedAttitudeEnabled))
        }
      />

      {missionTrajectory && (
        <MissionTrajectoryLine
          past={missionTrajectory.past}
          planned={missionTrajectory.planned}
          smoothing={false}
        />
      )}

      {missionMilestones.map((milestone) => (
        <MissionMilestoneMarker
          key={milestone.id}
          label={milestone.label}
          position={milestone.position}
        />
      ))}
    </>
  );
}
