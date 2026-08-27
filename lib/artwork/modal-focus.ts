export const MODAL_FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export const MODAL_FOCUS_OPTIONS = { preventScroll: true } as const;

export type ModalKeyEvent = {
  key: string;
  shiftKey: boolean;
  preventDefault: () => void;
};

export type ModalFocusTarget = {
  focus: (options?: FocusOptions) => void;
};

export type OverflowStyle = {
  overflow: string;
};

export function focusWithoutScrolling(
  target: ModalFocusTarget | null | undefined,
) {
  target?.focus(MODAL_FOCUS_OPTIONS);
}

export function isModalDismissKey(key: string): boolean {
  return key === "Escape";
}

export function lockBackgroundScroll(style: OverflowStyle): () => void {
  const previous = style.overflow;
  style.overflow = "hidden";
  return () => {
    style.overflow = previous;
  };
}

/**
 * Keep Tab inside a dialog. When focus is on the first/last control, or on a
 * non-tabbable element such as the heading, wrap to the other end.
 */
export function trapTabKey(
  event: ModalKeyEvent,
  focusables: readonly ModalFocusTarget[],
  active: ModalFocusTarget | null,
): boolean {
  if (event.key !== "Tab") return false;
  if (focusables.length === 0) {
    event.preventDefault();
    return true;
  }

  const first = focusables[0]!;
  const last = focusables[focusables.length - 1]!;
  const activeIndex = active ? focusables.indexOf(active) : -1;
  const outsideList = activeIndex === -1;

  if (event.shiftKey) {
    if (activeIndex === 0 || outsideList) {
      event.preventDefault();
      last.focus(MODAL_FOCUS_OPTIONS);
      return true;
    }
  } else if (activeIndex === focusables.length - 1 || outsideList) {
    event.preventDefault();
    first.focus(MODAL_FOCUS_OPTIONS);
    return true;
  }

  return false;
}
