export function LoginView({
  configured,
  nextPath,
  error,
  pending,
  unconfiguredMessage,
  formAction,
}: {
  configured: boolean;
  nextPath: string;
  error?: string | null;
  pending?: boolean;
  unconfiguredMessage: string;
  formAction?: string | ((formData: FormData) => void | Promise<void>);
}) {
  return (
    <main className="relative mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-5 py-20 sm:px-8">
      <p className="text-xs uppercase tracking-[0.22em] text-[var(--accent)]">
        Kim Osgood Archive
      </p>
      <h1 className="mt-3 font-display text-5xl tracking-tight text-[var(--ink)] sm:text-6xl">
        Private archive
      </h1>
      <p className="mt-5 max-w-xl text-[var(--muted)] leading-relaxed">
        Enter the shared access password to continue.
      </p>

      {!configured ? (
        <p className="mt-10 max-w-xl text-sm leading-relaxed text-[var(--danger)]">
          {unconfiguredMessage}
        </p>
      ) : (
        <form action={formAction} className="mt-10 max-w-sm">
          <input type="hidden" name="next" value={nextPath} />
          <label
            htmlFor="app-access-password"
            className="block text-xs uppercase tracking-[0.14em] text-[var(--muted)]"
          >
            Password
          </label>
          <input
            id="app-access-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="mt-2 w-full border border-[var(--line)] bg-[var(--surface-elevated)] px-3 py-3 text-sm text-[var(--ink)] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          />
          {error ? (
            <p className="mt-3 text-sm text-[var(--danger)]" role="alert">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={pending}
            className="mt-6 inline-flex border border-[var(--ink)] bg-[var(--ink)] px-6 py-3 text-sm uppercase tracking-[0.14em] text-[var(--paper)] transition hover:bg-[var(--ink-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:opacity-60"
          >
            {pending ? "Checking…" : "Continue"}
          </button>
        </form>
      )}
    </main>
  );
}
