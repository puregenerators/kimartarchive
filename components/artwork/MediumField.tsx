"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  MEDIUM_OTHER,
  PRIMARY_MEDIUMS,
  deriveCustomMedium,
  deriveMediumChoice,
  isPrimaryMedium,
  resolveMediumValue,
  type MediumChoice,
} from "@/lib/artwork/medium";

type MediumFieldProps = {
  id: string;
  value: string;
  onChange: (medium: string) => void;
  /** When true, include a blank option (shared default medium). */
  allowBlank?: boolean;
  label: string;
  customLabel: string;
  error?: string;
  required?: boolean;
  inputClassName: string;
  /** Optional hint under the custom input (e.g. examples). */
  customHint?: string;
  FieldWrapper: (props: {
    id: string;
    label: string;
    error?: string;
    required?: boolean;
    hint?: string;
    children: ReactNode;
  }) => ReactNode;
};

/**
 * Controlled Medium dropdown with conditional "Specify medium" input.
 * Parent state stays a single resolved `medium` string — never the literal "Other".
 */
export function MediumField({
  id,
  value,
  onChange,
  allowBlank = false,
  label,
  customLabel,
  error,
  required,
  inputClassName,
  customHint,
  FieldWrapper,
}: MediumFieldProps) {
  const [choice, setChoice] = useState<MediumChoice>(() =>
    deriveMediumChoice(value),
  );
  const [custom, setCustom] = useState(() => deriveCustomMedium(value));
  /** Keeps Other selected while custom text is still empty. */
  const [otherSelected, setOtherSelected] = useState(
    () => deriveMediumChoice(value) === MEDIUM_OTHER,
  );
  const lastEmittedRef = useRef(value);

  useEffect(() => {
    if (value === lastEmittedRef.current) return;
    lastEmittedRef.current = value;
    const nextChoice = deriveMediumChoice(value);
    setChoice(nextChoice);
    setCustom(deriveCustomMedium(value));
    setOtherSelected(nextChoice === MEDIUM_OTHER);
  }, [value]);

  const effectiveChoice: MediumChoice = otherSelected ? MEDIUM_OTHER : choice;
  const showCustom = effectiveChoice === MEDIUM_OTHER;

  const displayError =
    error &&
    showCustom &&
    (!custom.trim() || custom.trim() === MEDIUM_OTHER)
      ? "Enter the specific medium."
      : error;

  function emit(nextChoice: MediumChoice, nextCustom: string) {
    const resolved = resolveMediumValue(nextChoice, nextCustom);
    lastEmittedRef.current = resolved;
    onChange(resolved);
  }

  function selectChoice(next: MediumChoice) {
    if (next === MEDIUM_OTHER) {
      const nextCustom = isPrimaryMedium(value) ? "" : deriveCustomMedium(value);
      setOtherSelected(true);
      setChoice(MEDIUM_OTHER);
      setCustom(nextCustom);
      emit(MEDIUM_OTHER, nextCustom);
      return;
    }
    setOtherSelected(false);
    setChoice(next);
    setCustom("");
    emit(next, "");
  }

  function updateCustom(nextCustom: string) {
    setOtherSelected(true);
    setChoice(MEDIUM_OTHER);
    setCustom(nextCustom);
    emit(MEDIUM_OTHER, nextCustom);
  }

  const customId = `${id}-custom`;

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <FieldWrapper
        id={id}
        label={label}
        required={required}
        error={showCustom ? undefined : displayError}
      >
        <select
          id={id}
          value={effectiveChoice}
          onChange={(e) => selectChoice(e.target.value as MediumChoice)}
          className={inputClassName}
          aria-invalid={Boolean(displayError) && !showCustom}
        >
          {allowBlank ? <option value="">—</option> : null}
          {!allowBlank && effectiveChoice === "" ? (
            <option value="" disabled>
              Select medium
            </option>
          ) : null}
          {PRIMARY_MEDIUMS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
          <option value={MEDIUM_OTHER}>{MEDIUM_OTHER}</option>
        </select>
      </FieldWrapper>

      {showCustom ? (
        <FieldWrapper
          id={customId}
          label={customLabel}
          required={required}
          error={displayError}
          hint={customHint}
        >
          <input
            id={customId}
            value={custom}
            onChange={(e) => updateCustom(e.target.value)}
            className={inputClassName}
            placeholder="e.g. Watercolor, Drawing, Mixed media"
            aria-invalid={Boolean(displayError)}
          />
        </FieldWrapper>
      ) : null}
    </div>
  );
}
