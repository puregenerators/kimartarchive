export const BATCH_STEP_HEADING_ID = "batch-step-heading";

export const BATCH_STEP_SCROLL = {
  top: 0,
  left: 0,
  behavior: "auto",
} as const;

export type BatchStepScroller = {
  scrollTo: (options: ScrollToOptions) => void;
};

export type BatchStepDocument = {
  scrollingElement?: { scrollTop: number; scrollLeft: number } | null;
  documentElement?: { scrollTop: number; scrollLeft: number } | null;
  body?: { scrollTop: number; scrollLeft: number } | null;
};

export type BatchStepHeadingTarget = {
  focus: (options?: FocusOptions) => void;
};

function defaultWindow(): BatchStepScroller | null {
  if (typeof globalThis.scrollTo === "function") {
    return globalThis as unknown as BatchStepScroller;
  }
  return null;
}

function defaultDocument(): BatchStepDocument | null {
  if (typeof document === "undefined") return null;
  return document;
}

function resetScrollElement(
  element: { scrollTop: number; scrollLeft: number } | null | undefined,
) {
  if (!element) return;
  element.scrollTop = 0;
  element.scrollLeft = 0;
}

/** Instantly reset window (or document) scroll. In-page step changes do not. */
export function scrollBatchPageToTop(
  win: BatchStepScroller | null = defaultWindow(),
  doc: BatchStepDocument | null = defaultDocument(),
): void {
  resetScrollElement(doc?.scrollingElement);
  if (doc?.documentElement !== doc?.scrollingElement) {
    resetScrollElement(doc?.documentElement);
  }
  if (doc?.body !== doc?.scrollingElement && doc?.body !== doc?.documentElement) {
    resetScrollElement(doc?.body);
  }
  win?.scrollTo({ ...BATCH_STEP_SCROLL });
}

/**
 * Place the user at the start of an in-page batch step: top of the page and
 * keyboard/screen-reader focus on that step’s heading.
 */
export function enterBatchStep(
  heading: BatchStepHeadingTarget | null,
  win: BatchStepScroller | null = defaultWindow(),
  doc: BatchStepDocument | null = defaultDocument(),
): void {
  scrollBatchPageToTop(win, doc);
  heading?.focus({ preventScroll: true });
}
