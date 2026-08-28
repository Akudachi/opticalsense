import { useAuth } from "@/contexts/AuthContext";
import { initializeGlobalStatusListener } from "@/services/live/services";
import { Outlet, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/_authenticated")({
  component: AuthGate,
});

function AuthGate() {
  const { user, hydrated } = useAuth();
  const nav = useNavigate();
  
  // Initialize global MQTT status listener once when authenticated
  useEffect(() => {
    if (hydrated && user) {
      initializeGlobalStatusListener();
    }
  }, [hydrated, user]);
  
  useEffect(() => {
    if (hydrated && !user) {
      nav({ to: "/login", replace: true });
    }
  }, [hydrated, user, nav]);
  
  if (!hydrated || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-hero">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
      </div>
    );
  }
  return <Outlet />;
}
