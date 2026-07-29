import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@/types";

type AuthCtx = {
  user: User | null;
  hydrated: boolean;
  login: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, fullName: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (patch: Partial<Pick<User, "fullName" | "avatarUrl">>) => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

type ProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
};

function toUser(authUser: { id: string; email?: string | null }, profile: ProfileRow | null): User {
  const meta = (authUser as unknown as { user_metadata?: Record<string, string> }).user_metadata ?? {};
  return {
    id: authUser.id,
    email: profile?.email ?? authUser.email ?? "",
    fullName:
      profile?.full_name ??
      meta.full_name ??
      meta.name ??
      (authUser.email ? authUser.email.split("@")[0] : "Doctor"),
    role: "doctor",
    clinicId: authUser.id,
    avatarUrl: profile?.avatar_url ?? meta.avatar_url ?? meta.picture ?? undefined,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const loadProfile = useCallback(async (authUser: { id: string; email?: string | null }) => {
    const { data } = await supabase
      .from("profiles")
      .select("id, email, full_name, avatar_url")
      .eq("id", authUser.id)
      .maybeSingle();
    setUser(toUser(authUser, (data as ProfileRow | null) ?? null));
  }, []);

  useEffect(() => {
    // Listener first — never miss auth events
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        // Defer to avoid deadlocking inside the callback
        setTimeout(() => {
          void loadProfile(session.user);
        }, 0);
      } else {
        setUser(null);
      }
    });

    // Then hydrate existing session
    void supabase.auth.getSession().then(async ({ data }) => {
      if (data.session?.user) await loadProfile(data.session.user);
      setHydrated(true);
    });

    return () => sub.subscription.unsubscribe();
  }, [loadProfile]);

  const login = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signUp = useCallback(async (email: string, password: string, fullName: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
        data: { full_name: fullName },
      },
    });
    if (error) throw error;
  }, []);

  const loginWithGoogle = useCallback(async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/`,
      },
    });
    if (error) throw error;
  }, []);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
  }, []);

  const updateProfile = useCallback(
    async (patch: Partial<Pick<User, "fullName" | "avatarUrl">>) => {
      if (!user) return;
      const row: { full_name?: string | null; avatar_url?: string | null } = {};
      if ("fullName" in patch) row.full_name = patch.fullName ?? null;
      if ("avatarUrl" in patch) row.avatar_url = patch.avatarUrl ?? null;
      const { error } = await supabase
        .from("profiles")
        .update(row)
        .eq("id", user.id);
      if (error) throw error;
      setUser({ ...user, ...patch });
    },
    [user],
  );

  const value = useMemo(
    () => ({ user, hydrated, login, signUp, loginWithGoogle, logout, updateProfile }),
    [user, hydrated, login, signUp, loginWithGoogle, logout, updateProfile],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside <AuthProvider>");
  return v;
}
