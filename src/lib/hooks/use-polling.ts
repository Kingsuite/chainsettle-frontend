"use client";

import { useEffect, useRef } from "react";

interface UsePollingOptions {
  enabled?: boolean;
}

export function usePolling(
  fn: () => void | Promise<void>,
  intervalMs: number,
  { enabled = true }: UsePollingOptions = {},
): void {
  const callbackRef = useRef(fn);

  useEffect(() => {
    callbackRef.current = fn;
  }, [fn]);

  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let running = false;
    let runAgain = false;
    let stopped = false;

    const isVisible = () => document.visibilityState !== "hidden";

    const clearTimer = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const schedule = () => {
      if (stopped || !isVisible()) return;
      const jitteredInterval = intervalMs * (0.9 + Math.random() * 0.2);
      timer = setTimeout(() => {
        timer = null;
        void run();
      }, jitteredInterval);
    };

    const run = async () => {
      if (stopped || !isVisible()) return;
      if (running) {
        runAgain = true;
        return;
      }

      running = true;
      runAgain = false;
      try {
        await callbackRef.current();
      } catch (error) {
        console.error("Polling callback failed:", error);
      } finally {
        running = false;
        if (stopped || !isVisible()) return;
        if (runAgain) {
          runAgain = false;
          void run();
        } else {
          schedule();
        }
      }
    };

    const handleVisibilityChange = () => {
      clearTimer();
      if (isVisible()) {
        void run();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    // Callers own the initial fetch; becoming visible triggers an immediate refresh.
    schedule();

    return () => {
      stopped = true;
      clearTimer();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled, intervalMs]);
}
