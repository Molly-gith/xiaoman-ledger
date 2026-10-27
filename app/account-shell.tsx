"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { createLocalRepository } from "../lib/data/local-adapter";
import { createCloudRepository } from "../lib/data/cloud-adapter";
import { createAssistantMemoryRepository, type AssistantMemoryRepository } from "../lib/data/assistant-memory";
import { createCloudMemoryRepository } from "../lib/data/cloud-memory";
import type { LedgerRepository } from "../lib/data/repository";
import { LoadingScreen, PageHeader } from "./ledger-components";

export type WorkspaceScope = {
  mode: "guest" | "account";
  email: string | null;
  accountId?: string;
  repository: LedgerRepository;
  memoryRepository: AssistantMemoryRepository;
  memoryOwnerId?: string;
  isCurrent: () => boolean;
};
type Identity = { user: User | null; generation: number };

// Identity is an explicit boundary: drafts, dialogs, cached reads and undo all
// belong to one mounted workspace. Token refreshes for the same user preserve it.
export function AccountShell({ children }: { children: (scope: WorkspaceScope) => ReactNode }) {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [error, setError] = useState("");
  const current = useRef<{ id: string | null | undefined; generation: number }>({ id: undefined, generation: 0 });
  useEffect(() => {
    let active = true;
    const accept = (user: User | null) => {
      if (!active) return;
      const id = user?.id ?? null;
      if (current.current.id === id) return;
      current.current = { id, generation: current.current.generation + 1 };
      setError(""); setIdentity({ user, generation: current.current.generation });
    };
    // Never await Supabase operations inside this callback: it holds the auth lock.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => accept(session?.user ?? null));
    void supabase.auth.getSession().then(({ data, error: authError }) => {
      if (!active || current.current.id !== undefined) return;
      if (authError) setError("账号状态暂时无法确认，请检查网络后重新载入。");
      else accept(data.session?.user ?? null);
    }).catch(() => { if (active && current.current.id === undefined) setError("账号状态暂时无法确认，请重新载入。"); });
    return () => { active = false; subscription.unsubscribe(); current.current = { id: undefined, generation: current.current.generation + 1 }; };
  }, []);
  const isCurrent = useMemo(() => () => identity !== null && current.current.generation === identity.generation && current.current.id === (identity.user?.id ?? null), [identity]);
  if (!identity) return error ? <main className="app-shell simple-app"><PageHeader title="暂时无法打开账号" subtitle="原有账本没有改变" /><p role="alert">{error}</p><button className="primary" onClick={() => window.location.reload()}>重新载入</button></main> : <LoadingScreen text="正在打开小满" />;
  return <Workspace key={identity.generation} user={identity.user} isCurrent={isCurrent}>{children}</Workspace>;
}

function Workspace({ user, isCurrent, children }: { user: User | null; isCurrent: () => boolean; children: (scope: WorkspaceScope) => ReactNode }) {
  const [repository] = useState(() => user ? createCloudRepository(supabase, user.id, isCurrent) : createLocalRepository());
  const [memoryRepository] = useState(() => user ? createCloudMemoryRepository(supabase, user.id, isCurrent) : createAssistantMemoryRepository());
  // Guest memory may fail independently of the ledger. Let the assistant show
  // that error without blocking manual bookkeeping or the ledger fallback store.
  return children({ mode: user ? "account" : "guest", email: user?.email ?? null, accountId: user?.id, repository, memoryRepository, memoryOwnerId: user?.id, isCurrent });
}
