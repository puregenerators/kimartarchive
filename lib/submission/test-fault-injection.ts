/**
 * Development-only fault injection for controlled submission testing.
 *
 * Disabled by default. Ignored/rejected when NODE_ENV=production.
 * Never enable permanently. Never use for production traffic.
 *
 * Env (development only):
 *   ARTWORK_TEST_FAIL_OPERATION=upload_high_resolution
 *   ARTWORK_TEST_FAIL_INDEX=1   # 0-based artwork order in the batch
 */

export const TEST_FAULT_OPERATIONS = [
  "upload_high_resolution",
  "upload_hr",
  "upload_thumb",
] as const;

export type TestFaultOperation = (typeof TEST_FAULT_OPERATIONS)[number];

export type TestFaultConfig = {
  enabled: boolean;
  operation: TestFaultOperation | null;
  artworkIndex: number | null;
  reasonDisabled: string | null;
};

export class TestFaultInjectionError extends Error {
  readonly code = "TEST_FAULT_INJECTION" as const;
  readonly operation: TestFaultOperation;
  readonly artworkIndex: number;

  constructor(operation: TestFaultOperation, artworkIndex: number) {
    super(
      `Development-only test fault injected at ${operation} (artwork index ${artworkIndex}).`,
    );
    this.name = "TestFaultInjectionError";
    this.operation = operation;
    this.artworkIndex = artworkIndex;
  }
}

function parseArtworkIndex(raw: string | undefined): number | null {
  if (raw == null || raw.trim() === "") return null;
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function normalizeOperation(
  raw: string | undefined,
): TestFaultOperation | null {
  if (!raw) return null;
  const value = raw.trim().toLowerCase();
  if (value === "upload_high_resolution" || value === "upload_hr") {
    return value === "upload_hr" ? "upload_hr" : "upload_high_resolution";
  }
  if (value === "upload_thumb" || value === "upload_thumbnail") {
    return "upload_thumb";
  }
  return null;
}

/**
 * Resolve fault-injection config. Safe to call in any environment.
 * Production always returns enabled:false.
 */
export function resolveTestFaultConfig(
  source: NodeJS.ProcessEnv = process.env,
): TestFaultConfig {
  const operationRaw = source.ARTWORK_TEST_FAIL_OPERATION;
  const indexRaw = source.ARTWORK_TEST_FAIL_INDEX;
  const hasAny =
    Boolean(operationRaw?.trim()) || Boolean(indexRaw?.trim());

  if (source.NODE_ENV === "production") {
    return {
      enabled: false,
      operation: null,
      artworkIndex: null,
      reasonDisabled: hasAny
        ? "ARTWORK_TEST_FAIL_* is ignored in production builds."
        : "Fault injection disabled in production.",
    };
  }

  if (!hasAny) {
    return {
      enabled: false,
      operation: null,
      artworkIndex: null,
      reasonDisabled: "Fault injection disabled by default.",
    };
  }

  const operation = normalizeOperation(operationRaw);
  const artworkIndex = parseArtworkIndex(indexRaw);

  if (!operation || artworkIndex == null) {
    return {
      enabled: false,
      operation: null,
      artworkIndex: null,
      reasonDisabled:
        "ARTWORK_TEST_FAIL_OPERATION and ARTWORK_TEST_FAIL_INDEX must both be valid to enable fault injection.",
    };
  }

  return {
    enabled: true,
    operation,
    artworkIndex,
    reasonDisabled: null,
  };
}

/** True when the configured fault targets this artwork + operation. */
export function shouldInjectTestFault(params: {
  operation: TestFaultOperation | "upload_hr" | "upload_high_resolution";
  artworkIndex: number;
  source?: NodeJS.ProcessEnv;
}): boolean {
  const config = resolveTestFaultConfig(params.source);
  if (!config.enabled || config.operation == null || config.artworkIndex == null) {
    return false;
  }
  if (config.artworkIndex !== params.artworkIndex) return false;

  const requested =
    params.operation === "upload_hr"
      ? "upload_high_resolution"
      : params.operation;
  const configured =
    config.operation === "upload_hr"
      ? "upload_high_resolution"
      : config.operation;

  return requested === configured;
}

/**
 * Throw if a development-only fault is configured for this step.
 * No-op when disabled or in production.
 */
export function maybeThrowTestFault(params: {
  operation: TestFaultOperation | "upload_hr" | "upload_high_resolution";
  artworkIndex: number;
  source?: NodeJS.ProcessEnv;
}): void {
  if (
    !shouldInjectTestFault({
      operation: params.operation,
      artworkIndex: params.artworkIndex,
      source: params.source,
    })
  ) {
    return;
  }
  const config = resolveTestFaultConfig(params.source);
  throw new TestFaultInjectionError(
    config.operation ?? "upload_high_resolution",
    params.artworkIndex,
  );
}
