import "server-only";

/**
 * Server-side environment access. Secrets are only ever read here and never
 * hardcoded. `requireEnv` throws a clear error naming the missing variable so
 * misconfiguration surfaces immediately instead of as an opaque 401.
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

export function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value ? value : undefined;
}

export const isDemoMode = (): boolean => process.env.DEMO_MODE === "true";

export function paypalEnv(): "sandbox" {
  // Non-negotiable rule 8: sandbox only.
  const env = process.env.PAYPAL_ENV ?? "sandbox";
  if (env !== "sandbox") {
    throw new Error(`PAYPAL_ENV must be "sandbox" (got "${env}").`);
  }
  return "sandbox";
}
