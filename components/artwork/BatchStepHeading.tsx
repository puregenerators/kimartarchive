"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";

import {
  BATCH_STEP_HEADING_ID,
  enterBatchStep,
} from "@/lib/artwork/step-focus";

const HEADING_CLASS = [
  "scroll-mt-[68px] md:scroll-mt-16",
  "outline-none focus-visible:outline focus-visible:outline-2",
  "focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]",
  "font-display text-4xl tracking-tight text-[var(--ink)] sm:text-5xl",
].join(" ");

export function BatchStepHeading({
  children,
  className,
  enterOnMount = true,
}: {
  children: ReactNode;
  className?: string;
  /**
   * When false on first mount, skip scroll/focus (initial /new-artwork load).
   * Later mounts of this heading still enter when this is true on that mount.
   */
  enterOnMount?: boolean;
}) {
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const shouldEnterRef = useRef(enterOnMount);

  useLayoutEffect(() => {
    if (!shouldEnterRef.current) return;
    enterBatchStep(headingRef.current);
  }, []);

  return (
    <h1
      ref={headingRef}
      id={BATCH_STEP_HEADING_ID}
      tabIndex={-1}
      className={className ? `${HEADING_CLASS} ${className}` : HEADING_CLASS}
    >
      {children}
    </h1>
  );
}
