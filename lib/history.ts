import { useCallback, useEffect, useRef, useState } from "react";

export type HistoryControls = {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Forget all history (e.g. after loading a different project). */
  reset: () => void;
};

type UseHistoryOptions<T> = {
  /** Debounce window used to coalesce rapid edits (slider drags) into one step. */
  delayMs?: number;
  maxDepth?: number;
  /** Cheap equality signature; defaults to JSON serialization. */
  signature?: (value: T) => string;
};

/**
 * Time-travel history for an immutable `present` value.
 *
 * The caller keeps owning its state; `present` is a derived snapshot and
 * `apply` writes a snapshot back into the owning state. Edits are coalesced
 * with a debounce so dragging a slider produces a single undo step.
 */
export function useHistory<T>(present: T, apply: (value: T) => void, options: UseHistoryOptions<T> = {}): HistoryControls {
  const { delayMs = 350, maxDepth = 80, signature = (value: T) => JSON.stringify(value) } = options;

  const pastRef = useRef<T[]>([]);
  const futureRef = useRef<T[]>([]);
  const presentRef = useRef<T>(present);
  const burstRef = useRef<T | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const applyingRef = useRef(false);
  const signatureRef = useRef(signature);
  signatureRef.current = signature;

  const [, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((value) => value + 1), []);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    burstRef.current = null;
  }, []);

  useEffect(() => {
    if (applyingRef.current) {
      applyingRef.current = false;
      presentRef.current = present;
      return;
    }

    const previous = presentRef.current;
    if (previous === present) return;

    if (timerRef.current === null) burstRef.current = previous;
    presentRef.current = present;

    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const snapshot = burstRef.current;
      burstRef.current = null;
      if (snapshot === null) return;
      if (signatureRef.current(snapshot) === signatureRef.current(presentRef.current)) return;
      pastRef.current = [...pastRef.current, snapshot].slice(-maxDepth);
      futureRef.current = [];
      bump();
    }, delayMs);
  }, [present, delayMs, maxDepth, bump]);

  useEffect(() => clearTimer, [clearTimer]);

  const undo = useCallback(() => {
    clearTimer();
    if (pastRef.current.length === 0) return;
    const value = pastRef.current[pastRef.current.length - 1];
    pastRef.current = pastRef.current.slice(0, -1);
    futureRef.current = [...futureRef.current, presentRef.current];
    if (signatureRef.current(value) !== signatureRef.current(presentRef.current)) {
      applyingRef.current = true;
      apply(value);
    }
    bump();
  }, [apply, bump, clearTimer]);

  const redo = useCallback(() => {
    clearTimer();
    if (futureRef.current.length === 0) return;
    const value = futureRef.current[futureRef.current.length - 1];
    futureRef.current = futureRef.current.slice(0, -1);
    pastRef.current = [...pastRef.current, presentRef.current];
    if (signatureRef.current(value) !== signatureRef.current(presentRef.current)) {
      applyingRef.current = true;
      apply(value);
    }
    bump();
  }, [apply, bump, clearTimer]);

  const reset = useCallback(() => {
    clearTimer();
    pastRef.current = [];
    futureRef.current = [];
    bump();
  }, [bump, clearTimer]);

  return {
    undo,
    redo,
    canUndo: pastRef.current.length > 0,
    canRedo: futureRef.current.length > 0,
    reset,
  };
}
