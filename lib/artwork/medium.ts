/**
 * Controlled Medium choices for intake.
 *
 * Persisted / submitted value is always a single resolved string (`medium`).
 * UI may temporarily track choice + custom text, but never stores the literal
 * dropdown value "Other" as the final medium.
 */

export const PRIMARY_MEDIUMS = ["Monotype", "Painting"] as const;

export type PrimaryMedium = (typeof PRIMARY_MEDIUMS)[number];

/** Dropdown choice, including blank (shared defaults) and Other. */
export type MediumChoice = "" | PrimaryMedium | "Other";

export const MEDIUM_OTHER = "Other" as const;

export function isPrimaryMedium(value: string): value is PrimaryMedium {
  return (PRIMARY_MEDIUMS as readonly string[]).includes(value);
}

/**
 * Map a stored medium string onto the dropdown choice.
 * Non-primary, non-empty values (e.g. Watercolor) map to Other.
 * Empty / whitespace-only maps to blank.
 */
export function deriveMediumChoice(medium: string): MediumChoice {
  if (isPrimaryMedium(medium)) return medium;
  if (!medium.trim()) return "";
  return MEDIUM_OTHER;
}

/** Custom text shown when the choice is Other; empty for primary/blank. */
export function deriveCustomMedium(medium: string): string {
  if (isPrimaryMedium(medium)) return "";
  return medium;
}

/**
 * Resolve dropdown choice + optional custom text into the stored medium.
 * Never returns the literal "Other".
 */
export function resolveMediumValue(
  choice: MediumChoice,
  customMedium: string,
): string {
  if (choice === "Monotype" || choice === "Painting") return choice;
  if (choice === MEDIUM_OTHER) return customMedium;
  return "";
}

/** Trim for validation / submission. */
export function normalizeMedium(medium: string): string {
  return medium.trim();
}

export type MediumValidationError =
  | "Medium is required."
  | "Enter the specific medium.";

/**
 * Validate the resolved medium string (not dropdown state).
 * Whitespace-only and the literal word "Other" are rejected.
 */
export function validateMediumValue(
  medium: string,
): MediumValidationError | null {
  const trimmed = normalizeMedium(medium);
  if (!trimmed) {
    // Distinguish never-filled vs whitespace / abandoned Other custom.
    if (medium.length > 0) {
      return "Enter the specific medium.";
    }
    return "Medium is required.";
  }
  if (trimmed === MEDIUM_OTHER) {
    return "Enter the specific medium.";
  }
  return null;
}
