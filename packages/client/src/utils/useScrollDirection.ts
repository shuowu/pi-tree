import { useCallback, useEffect, useRef, useState } from "react";

export type ScrollDirection = "up" | "down" | null;

interface UseScrollDirectionOptions {
  /** Minimum scroll distance before direction change triggers (dead zone to prevent jitter) */
  threshold?: number;
  /** The scrollable element ref — if not provided, uses window */
  scrollRef?: React.RefObject<HTMLElement | null>;
}

/**
 * Detects sustained scroll direction in a container.
 * Implements the standard "shy header" UX pattern with a dead zone
 * to prevent flickering on small/incidental scroll movements.
 *
 * @see https://web.dev/patterns/web-vitals-patterns/scroll-driven-animations
 */
export function useScrollDirection({
  threshold = 50,
  scrollRef,
}: UseScrollDirectionOptions = {}): ScrollDirection {
  const [direction, setDirection] = useState<ScrollDirection>(null);
  const lastScrollTop = useRef(0);
  const accumulatedDelta = useRef(0);
  const ticking = useRef(false);

  const update = useCallback(() => {
    const el = scrollRef?.current;
    if (!el) return;

    const scrollTop = el.scrollTop;
    const delta = scrollTop - lastScrollTop.current;

    // Skip if no movement
    if (delta === 0) {
      ticking.current = false;
      return;
    }

    // Accumulate delta in the same direction; reset if direction reverses
    if (
      (accumulatedDelta.current > 0 && delta < 0) ||
      (accumulatedDelta.current < 0 && delta > 0)
    ) {
      accumulatedDelta.current = 0;
    }
    accumulatedDelta.current += delta;

    // Only trigger direction change after crossing the threshold
    if (accumulatedDelta.current > threshold) {
      setDirection("down");
      accumulatedDelta.current = 0;
    } else if (accumulatedDelta.current < -threshold) {
      setDirection("up");
      accumulatedDelta.current = 0;
    }

    // At the very top, always show header
    if (scrollTop <= 10) {
      setDirection("up");
      accumulatedDelta.current = 0;
    }

    lastScrollTop.current = scrollTop;
    ticking.current = false;
  }, [scrollRef, threshold]);

  useEffect(() => {
    const el = scrollRef?.current;
    if (!el) return;

    const onScroll = () => {
      if (!ticking.current) {
        ticking.current = true;
        requestAnimationFrame(update);
      }
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [scrollRef, update]);

  return direction;
}
