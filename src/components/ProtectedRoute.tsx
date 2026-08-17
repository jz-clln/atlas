import { Navigate } from "react-router-dom";
import { useSession } from "../lib/useSession";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useSession();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cloud">
        <p className="font-mono text-sm text-charcoal">loading session…</p>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}