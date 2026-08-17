import { useState } from "react";
import { Navigate } from "react-router-dom";
import { signInWithGoogleClassroom } from "../lib/supabase";
import { useSession } from "../lib/useSession";
import { AtlasOrb } from "../components/AtlasOrb";

export function Login() {
  const { session, loading } = useSession();
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!loading && session) {
    return <Navigate to="/dashboard" replace />;
  }

  async function handleSignIn() {
    setError(null);
    setIsConnecting(true);
    try {
      await signInWithGoogleClassroom();
    } catch (err) {
      setIsConnecting(false);
      setError(
        err instanceof Error ? err.message : "Couldn't start sign-in. Try again."
      );
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-between bg-cloud px-6 py-14 sm:py-20">
      <div />

      <div className="flex flex-col items-center text-center">
        <div className="animate-atlas-fade-up">
          <AtlasOrb />
        </div>

        <p
          className="mt-8 animate-atlas-fade-up font-mono text-xs uppercase tracking-[0.2em] text-slate"
          style={{ animationDelay: "150ms" }}
        >
          atlas
        </p>

        <h1
          className="mt-3 max-w-sm animate-atlas-fade-up text-3xl font-semibold leading-snug text-ink sm:text-4xl"
          style={{ animationDelay: "250ms" }}
        >
          Hey. It's been a minute.
        </h1>

        <p
          className="mt-3 max-w-xs animate-atlas-fade-up text-sm leading-relaxed text-charcoal"
          style={{ animationDelay: "350ms" }}
        >
          Sign in and I'll catch you up on what's due.
        </p>
      </div>

      <div
        className="flex animate-atlas-fade-up flex-col items-center"
        style={{ animationDelay: "450ms" }}
      >
        <button
          onClick={handleSignIn}
          disabled={isConnecting}
          className="flex items-center gap-3 rounded-full bg-ink px-8 py-4 text-sm font-medium text-white shadow-[0_8px_30px_-10px_rgba(0,0,0,0.5)] transition-all duration-200 hover:scale-[1.02] hover:shadow-[0_12px_40px_-10px_rgba(0,0,0,0.55)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <GoogleIcon />
          {isConnecting ? "One sec…" : "Sign in with Google"}
        </button>

        {error && (
          <p className="mt-4 text-sm text-charcoal" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.71H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.71A5.4 5.4 0 0 1 3.68 9c0-.59.1-1.17.29-1.71V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.04l3.01-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.59-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}