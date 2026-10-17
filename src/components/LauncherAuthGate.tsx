import { useState } from "react";
import { Loader2, ShieldCheck, User, Lock } from "lucide-react";
import AmethystLogo from "./AmethystLogo";
import type { UserPublic } from "../types/global";

interface LauncherAuthGateProps {
  onAuthed: (user: UserPublic) => void;
}

export default function LauncherAuthGate({ onAuthed }: LauncherAuthGateProps) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit() {
    setError("");
    if (!username.trim() || !password) {
      setError("Username and password are required.");
      return;
    }
    if (mode === "register" && password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const user =
        mode === "login"
          ? await window.amethyst.launcherAuth.login(username, password)
          : await window.amethyst.launcherAuth.register(username, password);
      onAuthed(user);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function switchMode(next: "login" | "register") {
    setMode(next);
    setPassword("");
    setConfirmPassword("");
    setError("");
  }

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-6 rounded-xl bg-bg text-zinc-100">
      <AmethystLogo size={72} />

      <div className="w-[360px] rounded-2xl border border-border bg-bg-card p-5">
        <div className="mb-4 flex rounded-lg bg-bg-elevated p-1">
          <button
            onClick={() => switchMode("login")}
            className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${
              mode === "login" ? "bg-accent text-accent-fg" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Log in
          </button>
          <button
            onClick={() => switchMode("register")}
            className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${
              mode === "register" ? "bg-accent text-accent-fg" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Create account
          </button>
        </div>

        <div className="flex flex-col gap-3">
          {mode === "register" && (
            <p className="text-xs text-zinc-500">
              This is a launcher account, separate from your Minecraft login - it just keeps your
              settings and profile on this install.            </p>
          )}

          <div className="relative">
            <User size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username"
              className="w-full rounded-lg border border-border-light bg-bg-elevated py-2 pl-9 pr-3 text-sm text-zinc-100 outline-none focus:border-accent"
            />
          </div>

          <div className="relative">
            <Lock size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && mode === "login" && handleSubmit()}
              placeholder="Password"
              className="w-full rounded-lg border border-border-light bg-bg-elevated py-2 pl-9 pr-3 text-sm text-zinc-100 outline-none focus:border-accent"
            />
          </div>

          {mode === "register" && (
            <div className="relative">
              <Lock size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                placeholder="Confirm password"
                className="w-full rounded-lg border border-border-light bg-bg-elevated py-2 pl-9 pr-3 text-sm text-zinc-100 outline-none focus:border-accent"
              />
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={busy || !username || !password}
            className="flex items-center justify-center gap-2 rounded-lg bg-accent py-2.5 text-sm font-bold text-accent-fg hover:bg-accent-hover disabled:opacity-50 transition-colors"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />}
            {mode === "login" ? "Log in" : "Create account & continue"}
          </button>

          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
      </div>
    </div>
  );
}
