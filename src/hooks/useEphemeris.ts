/**
 * useEphemeris Hook
 * Fetches and manages ephemeris data with error handling, validation, and fallback support
 */

"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { EphemerisData, EphemerisResponse, DataSource } from "@/lib/types";
import { API_BASE_URL } from "@/lib/api";
import { toast } from "sonner";

// --- Types ---

export interface EphemerisState {
  data: EphemerisData[];
  isLoading: boolean;
  error: EphemerisError | null;
  source: DataSource | null;
  isFallback: boolean;
}

export interface EphemerisError {
  type: EphemerisErrorType;
  message: string;
  technicalDetails?: string;
  canRetry: boolean;
}

export type EphemerisErrorType =
  | "NASA_API_ERROR"
  | "NETWORK_ERROR"
  | "VALIDATION_ERROR"
  | "TIMEOUT_ERROR"
  | "UNKNOWN_ERROR";

interface UseEphemerisOptions {
  date?: string; // YYYY-MM-DD format
  spanDays?: number;
  autoFetch?: boolean;
  timeoutMs?: number;
}

interface FetchEphemerisParams {
  date: string;
  spanDays: number;
  timeoutMs: number;
  force?: boolean;
  signal?: AbortSignal;
}

class EphemerisFetchError extends Error {
  readonly type: EphemerisErrorType;
  readonly canRetry: boolean;
  readonly technicalDetails?: string;
  readonly isAbort: boolean;

  constructor(
    type: EphemerisErrorType,
    message: string,
    canRetry: boolean,
    technicalDetails?: string,
    isAbort = false,
  ) {
    super(message);
    this.type = type;
    this.canRetry = canRetry;
    this.technicalDetails = technicalDetails;
    this.isAbort = isAbort;
  }
}

// --- Constants ---

const DEFAULT_TIMEOUT_MS = 15000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const STALE_TIME_MS = 60 * 1000; // 1 minute

// --- Helper Functions (outside hook for stability) ---

function validateData(data: EphemerisData[]): EphemerisData[] {
  return data.filter((item) => {
    if (!item.bodyId || !item.name || !item.position) {
      console.warn(`[useEphemeris] Invalid entry - missing fields:`, item);
      return false;
    }

    const { x, y, z } = item.position;
    if (!isFinite(x) || !isFinite(y) || !isFinite(z)) {
      console.warn(
        `[useEphemeris] Invalid position for ${item.name}:`,
        item.position,
      );
      return false;
    }

    return true;
  });
}

async function loadFallbackData(): Promise<EphemerisData[]> {
  try {
    const fallback = await import("@/lib/fallback_planets.json");
    const validated = validateData(fallback.data as EphemerisData[]);
    console.log(
      `[useEphemeris] Loaded ${validated.length} bodies from fallback`,
    );
    return validated;
  } catch (error) {
    console.error("[useEphemeris] Failed to load fallback data:", error);
    return [];
  }
}

function toEphemerisError(error: EphemerisFetchError): EphemerisError {
  return {
    type: error.type,
    message: error.message,
    technicalDetails: error.technicalDetails,
    canRetry: error.canRetry,
  };
}

async function fetchEphemeris({
  date,
  spanDays,
  timeoutMs,
  force = false,
  signal,
}: FetchEphemerisParams): Promise<EphemerisResponse> {
  const abortController = new AbortController();
  let didTimeout = false;

  const timeoutId = setTimeout(() => {
    didTimeout = true;
    abortController.abort();
  }, timeoutMs);

  const handleAbort = () => abortController.abort();
  if (signal) {
    if (signal.aborted) {
      abortController.abort();
    } else {
      signal.addEventListener("abort", handleAbort, { once: true });
    }
  }

  try {
    const url = force
      ? `${API_BASE_URL}/api/ephemeris?date=${date}&spanDays=${spanDays}&force=true`
      : `${API_BASE_URL}/api/ephemeris?date=${date}&spanDays=${spanDays}`;

    const response = await fetch(url, {
      signal: abortController.signal,
    });

    if (!response.ok) {
      throw new EphemerisFetchError(
        "NASA_API_ERROR",
        `API error: ${response.status} ${response.statusText}`,
        true,
      );
    }

    const result: EphemerisResponse = await response.json();

    if (!result.data || !Array.isArray(result.data)) {
      throw new EphemerisFetchError(
        "VALIDATION_ERROR",
        "Invalid API response format: missing data array",
        false,
      );
    }

    const validatedData = validateData(result.data);

    if (validatedData.length === 0) {
      throw new EphemerisFetchError(
        "VALIDATION_ERROR",
        "No valid ephemeris data received",
        false,
      );
    }

    return {
      ...result,
      data: validatedData,
    };
  } catch (error) {
    if (error instanceof EphemerisFetchError) {
      throw error;
    }

    if (error instanceof Error && error.name === "AbortError") {
      if (didTimeout) {
        throw new EphemerisFetchError(
          "TIMEOUT_ERROR",
          "Request timed out",
          true,
          `Timeout after ${timeoutMs}ms`,
        );
      }

      throw new EphemerisFetchError(
        "UNKNOWN_ERROR",
        "Request aborted",
        false,
        undefined,
        true,
      );
    }

    if (error instanceof TypeError && error.message.includes("fetch")) {
      throw new EphemerisFetchError(
        "NETWORK_ERROR",
        "Network error while fetching ephemeris data",
        true,
        error.message,
      );
    }

    throw new EphemerisFetchError(
      "UNKNOWN_ERROR",
      "Unknown error occurred",
      true,
      error instanceof Error ? error.stack : undefined,
    );
  } finally {
    clearTimeout(timeoutId);
    if (signal) {
      signal.removeEventListener("abort", handleAbort);
    }
  }
}

// --- Hook ---

export function useEphemeris(options: UseEphemerisOptions = {}) {
  const {
    date = new Date().toISOString().split("T")[0],
    spanDays = 30,
    autoFetch = true,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  const queryClient = useQueryClient();
  const [fallbackData, setFallbackData] = useState<EphemerisData[] | null>(
    null,
  );
  const [fallbackError, setFallbackError] = useState<EphemerisError | null>(
    null,
  );
  const [source, setSource] = useState<DataSource | null>(null);
  const [isFallback, setIsFallback] = useState(false);
  const [isFallbackLoading, setIsFallbackLoading] = useState(false);

  const query = useQuery<EphemerisResponse, EphemerisFetchError>({
    queryKey: ["ephemeris", date, spanDays],
    queryFn: ({ signal }) =>
      fetchEphemeris({ date, spanDays, timeoutMs, signal }),
    enabled: autoFetch,
    retry: (failureCount, error) =>
      error.canRetry && failureCount < MAX_RETRIES,
    retryDelay: (attempt) => RETRY_DELAY_MS * attempt,
    staleTime: STALE_TIME_MS,
    networkMode: "always",
  });

  const COLD_START_THRESHOLD_MS = 1000;

  useEffect(() => {
    if (!query.isFetching) return;

    const timer = setTimeout(() => {
      if (query.isFetching) {
        toast.info("Conectando aos servidores espaciais...", {
          id: "cold-start-toast",
          duration: 8000,
        });
      }
    }, COLD_START_THRESHOLD_MS);

    return () => {
      clearTimeout(timer);
      toast.dismiss("cold-start-toast");
    };
  }, [query.isFetching]);

  useEffect(() => {
    if (!query.data) return;

    setFallbackData(null);
    setFallbackError(null);
    setIsFallback(false);
    setSource(query.data.meta.source);
  }, [query.data]);

  useEffect(() => {
    if (!query.error || query.error.isAbort) return;

    let cancelled = false;
    setIsFallbackLoading(true);

    loadFallbackData()
      .then((data) => {
        if (cancelled) return;
        setFallbackData(data);
        setIsFallback(true);
        setSource("FALLBACK_DATASET");
        setFallbackError(toEphemerisError(query.error));
      })
      .finally(() => {
        if (!cancelled) {
          setIsFallbackLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [query.error]);

  const data = query.data?.data ?? fallbackData ?? [];
  const isLoading = query.isFetching || isFallbackLoading;

  const retry = () => {
    setFallbackData(null);
    setFallbackError(null);
    setIsFallback(false);
    query.refetch();
  };

  const refresh = async () => {
    setFallbackData(null);
    setFallbackError(null);
    setIsFallback(false);

    try {
      await queryClient.fetchQuery({
        queryKey: ["ephemeris", date, spanDays],
        queryFn: ({ signal }) =>
          fetchEphemeris({ date, spanDays, timeoutMs, force: true, signal }),
      });
    } catch (error) {
      if (error instanceof EphemerisFetchError && error.isAbort) return;
      // Let the query error flow trigger fallback handling in the effect.
    }
  };

  return {
    data,
    isLoading,
    error: fallbackError,
    source,
    isFallback,
    retry,
    refresh,
    retryCount: query.failureCount ?? 0,
  };
}
