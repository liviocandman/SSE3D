import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useTrajectoryClient } from "./useTrajectoryClient";

const fetchTrajectoryRawMock = vi.fn();

vi.mock("@/hooks/useTrajectoryWorker", () => ({
  useTrajectoryWorker: () => ({
    fetchTrajectoryRaw: fetchTrajectoryRawMock,
  }),
}));

describe("useTrajectoryClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchTrajectoryRawMock.mockReset();
    global.fetch = vi.fn();
  });

  it("does not burn orbit-line cooldown when the first request aborts", async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.signal?.aborted) {
          throw new Error("AbortError");
        }
        return {
          ok: true,
          json: async () => ({ data: [] }),
        };
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [] }),
      });
    global.fetch = fetchMock as typeof fetch;

    const { result } = renderHook(() => useTrajectoryClient());
    const abortedController = new AbortController();
    abortedController.abort();

    await expect(
      result.current.requestOrbitLines(["301"], abortedController.signal),
    ).rejects.toThrow("AbortError");

    await expect(result.current.requestOrbitLines(["301"])).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
