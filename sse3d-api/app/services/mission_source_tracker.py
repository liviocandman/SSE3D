from typing import Optional
from loguru import logger
from app.models.mission_schemas import MissionDataSource

class MissionSourceTracker:
    def __init__(self):
        self._last_source: Optional[MissionDataSource] = None
        self._last_fallback_state: Optional[bool] = None
        self._last_stale_state: bool = False

    def log_transition(self, new_source: MissionDataSource, fallback_active: bool, is_stale: bool = False):
        """
        Transition-based logging for Story 7.2.
        Only logs when source, fallback state, or staleness changes.
        """
        # Source changes
        if new_source != self._last_source:
            logger.info(f"MISSION SOURCE CHANGE: {self._last_source} -> {new_source}")
            self._last_source = new_source

        # Fallback transitions
        if fallback_active != self._last_fallback_state:
            if fallback_active:
                logger.warning("MISSION FALLBACK ACTIVATED: System is running on degraded/predicted data.")
            else:
                logger.info("MISSION FALLBACK CLEARED: Live telemetry recovered.")
            self._last_fallback_state = fallback_active

        # Telemetry gaps (P2 fix for Story 7.2)
        if is_stale != self._last_stale_state:
            if is_stale:
                logger.warning("MISSION TELEMETRY GAP DETECTED: Data freshness exceeds nominal threshold.")
            else:
                logger.info("MISSION TELEMETRY REFRESHED: Nominal data flow resumed.")
            self._last_stale_state = is_stale

mission_source_tracker = MissionSourceTracker()
