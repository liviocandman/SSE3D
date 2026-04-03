import httpx
import time
from typing import Dict, Any, Optional
from loguru import logger
from app.core.config import settings

class AROWClient:
    """
    Defensive client for fetching live mission data from NASA AROW (Artemis Real-time Orbit Website).
    """
    def __init__(self):
        self.url = settings.arow_live_url
        self.timeout = settings.arow_timeout_seconds
        self.user_agent = settings.arow_user_agent
        self.retries = settings.arow_retry_count

    async def fetch_live_data(self) -> Dict[str, Any]:
        """
        Fetches the raw payload and relevant headers from the AROW source.
        """
        headers = {"User-Agent": self.user_agent}
        
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            for attempt in range(self.retries + 1):
                try:
                    logger.debug(f"Fetching AROW data (attempt {attempt + 1})...")
                    start_time = time.time()
                    response = await client.get(self.url, headers=headers)
                    duration = time.time() - start_time
                    
                    response.raise_for_status()
                    
                    fetched_at = datetime_now_iso()
                    
                    # Extract relevant headers for freshness calculation
                    relevant_headers = {
                        "etag": response.headers.get("ETag"),
                        "last-modified": response.headers.get("Last-Modified"),
                        "cache-control": response.headers.get("Cache-Control"),
                        "age": response.headers.get("Age"),
                        "date": response.headers.get("Date"),
                        "content-type": response.headers.get("Content-Type"),
                    }
                    
                    logger.info(f"AROW fetch successful ({duration:.2f}s, status {response.status_code})")
                    
                    return {
                        "raw_payload": response.json(),
                        "headers": relevant_headers,
                        "fetched_at": fetched_at,
                        "status_code": response.status_code
                    }
                    
                except httpx.HTTPStatusError as e:
                    logger.warning(f"AROW HTTP error (attempt {attempt + 1}): {e.response.status_code}")
                    if attempt == self.retries:
                        raise
                except (httpx.RequestError, httpx.TimeoutException) as e:
                    logger.warning(f"AROW connection error (attempt {attempt + 1}): {str(e)}")
                    if attempt == self.retries:
                        raise
        
        raise RuntimeError("Unexpected failure in AROWClient")

def datetime_now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
