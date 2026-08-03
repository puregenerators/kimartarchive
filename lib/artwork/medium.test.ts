/**
 * Medium choice / resolution helpers.
 * Run: npx tsx lib/artwork/medium.test.ts
 */

import {
  deriveCustomMedium,
  deriveMediumChoice,
  isPrimaryMedium,
  normalizeMedium,
  resolveMediumValue,
  validateMediumValue,
} from "./medium";

type TestCase = {
  name: string;
  run: () => void;
};

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(
      `${message}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`,
    );
  }
}

const tests: TestCase[] = [
  {
    name: "Monotype resolves to Monotype",
    run: () => {
      assertEqual(resolveMediumValue("Monotype", ""), "Monotype", "resolve");
      assertEqual(deriveMediumChoice("Monotype"), "Monotype", "derive choice");
      assertEqual(validateMediumValue("Monotype"), null, "valid");
    },
  },
  {
    name: "Painting resolves to Painting",
    run: () => {
      assertEqual(resolveMediumValue("Painting", ""), "Painting", "resolve");
      assertEqual(deriveMediumChoice("Painting"), "Painting", "derive choice");
      assertEqual(validateMediumValue("Painting"), null, "valid");
    },
  },
  {
    name: "Other requires a custom value",
    run: () => {
      assertEqual(resolveMediumValue("Other", ""), "", "empty custom → empty");
      assertEqual(
        validateMediumValue(resolveMediumValue("Other", "")),
        "Medium is required.",
        "empty Other fails",
      );
    },
  },
  {
    name: "Other + Watercolor resolves to Watercolor",
    run: () => {
      assertEqual(
        resolveMediumValue("Other", "Watercolor"),
        "Watercolor",
        "resolve",
      );
      assertEqual(validateMediumValue("Watercolor"), null, "valid");
      assertEqual(isPrimaryMedium("Watercolor"), false, "not primary");
    },
  },
  {
    name: "whitespace custom medium fails",
    run: () => {
      assertEqual(
        validateMediumValue("   "),
        "Enter the specific medium.",
        "whitespace",
      );
      assertEqual(
        validateMediumValue(resolveMediumValue("Other", "  \t  ")),
        "Enter the specific medium.",
        "Other + whitespace",
      );
    },
  },
  {
    name: "existing custom value loads as Other + custom text",
    run: () => {
      assertEqual(deriveMediumChoice("Watercolor"), "Other", "choice");
      assertEqual(deriveCustomMedium("Watercolor"), "Watercolor", "custom");
      assertEqual(deriveMediumChoice("Drawing"), "Other", "drawing choice");
      assertEqual(deriveCustomMedium("Drawing"), "Drawing", "drawing custom");
      assertEqual(deriveCustomMedium("Monotype"), "", "primary has no custom");
      assertEqual(deriveMediumChoice(""), "", "blank stays blank");
    },
  },
  {
    name: "literal dropdown value Other is never a valid stored medium",
    run: () => {
      assertEqual(
        validateMediumValue("Other"),
        "Enter the specific medium.",
        "rejects Other",
      );
      assertEqual(
        resolveMediumValue("Other", "Other"),
        "Other",
        "resolve can produce Other only if typed as custom",
      );
      assertEqual(
        validateMediumValue(normalizeMedium("Other")),
        "Enter the specific medium.",
        "normalized Other still invalid",
      );
    },
  },
  {
    name: "blank shared choice resolves to empty string",
    run: () => {
      assertEqual(resolveMediumValue("", "ignored"), "", "blank choice");
    },
  },
];

let failed = 0;

for (const test of tests) {
  try {
    test.run();
    console.log(`ok  — ${test.name}`);
  } catch (error) {
    failed += 1;
    console.error(`fail — ${test.name}`);
    console.error(error instanceof Error ? error.message : error);
  }
}

if (failed > 0) {
  console.error(`\n${failed} test(s) failed.`);
  process.exit(1);
}

console.log(`\nAll ${tests.length} medium helper tests passed.`);
