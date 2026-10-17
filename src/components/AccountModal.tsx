import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, Loader2, Check, Trash2, Plus, ShieldCheck, WifiOff, AlertTriangle } from "lucide-react";
import type { Account } from "../types/global";

interface AccountModalProps {
  open: boolean;
  /** Saved accounts, already ordered most-recently-used first. */
  accounts: Account[];
  activeAccount: Account | null;
  defaultUsername: string;
  /** Set when the startup refresh found the active Microsoft session could
   * no longer be renewed - the one case where a saved account still needs a
   * real sign-in. */
  sessionError: string | null;
  onClose: () => void;
  onOfflineLogin: (username: string) => Promise<void>;
  onMicrosoftLogin: () => Promise<void>;
  onSelect: (account: Account) => Promise<void>;
  onRemove: (account: Account) => Promise<void>;
}

/** Two accounts are the same player only if both the UUID and the auth mode
 * match, so an offline "Steve" and a Microsoft "Steve" stay separate rows. */
function accountKey(account: Account) {
  return `${account.authMode}:${account.uuid}`;
}

/** Crafatar mirrors Mojang's session server and falls back to the default
 * skin for UUIDs it doesn't know - which is every offline account, since
 * those UUIDs are just an MD5 of the username. */
function avatarUrl(account: Account) {
  return `https://crafatar.com/avatars/${account.uuid}?size=64&overlay`;
}

function AccountAvatar({ account }: { account: Account }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [account.uuid]);

  if (failed) {
    return (
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-bg-elevated text-sm font-bold text-accent">
        {account.name.slice(0, 1).toUpperCase()}
      </div>
    );
  }
  return (
    <img
      src={avatarUrl(account)}
      alt=""
      onError={() => setFailed(true)}
      className="h-10 w-10 shrink-0 rounded-lg bg-bg-elevated"
      style={{ imageRendering: "pixelated" }}
    />
  );
}

function AccountRow({
  account,
  active,
  busy,
  disabled,
  onSelect,
  onRemove,
}: {
  account: Account;
  active: boolean;
  busy: boolean;
  disabled: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const microsoft = account.authMode === "microsoft";

  return (
    <div
      className={`flex items-center gap-3 rounded-xl border p-2.5 transition-colors ${
        active ? "border-accent bg-accent/10" : "border-border bg-bg-elevated hover:border-border-light"
      }`}
    >
      <AccountAvatar account={account} />

      <button
        onClick={onSelect}
        disabled={disabled || active}
        className="flex min-w-0 flex-1 flex-col items-start text-left disabled:cursor-default"
      >
        <span className="w-full truncate text-sm font-semibold text-zinc-100">{account.name}</span>
        <span className="flex items-center gap-1 text-[11px] text-zinc-500">
          {microsoft ? <ShieldCheck size={11} /> : <WifiOff size={11} />}
          {microsoft ? "Microsoft account" : "Offline account"}
        </span>
      </button>

      {busy ? (
        <Loader2 size={16} className="shrink-0 animate-spin text-accent" />
      ) : active ? (
        <span className="flex shrink-0 items-center gap-1 rounded-md bg-accent px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-accent-fg">
          <Check size={11} /> In use
        </span>
      ) : (
        <button
          onClick={onSelect}
          disabled={disabled}
          className="shrink-0 rounded-md border border-border-light px-2.5 py-1 text-[11px] font-semibold text-zinc-300 transition-colors hover:border-accent hover:text-accent disabled:opacity-40"
        >
          Switch
        </button>
      )}

      {confirmingRemove ? (
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={() => {
              setConfirmingRemove(false);
              onRemove();
            }}
            className="rounded-md bg-red-500 px-2 py-1 text-[11px] font-semibold text-white hover:bg-red-600"
          >
            Remove
          </button>
          <button
            onClick={() => setConfirmingRemove(false)}
            className="rounded-md px-1.5 py-1 text-[11px] text-zinc-500 hover:text-zinc-200"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          title="Forget this account"
          onClick={() => setConfirmingRemove(true)}
          disabled={disabled}
          className="shrink-0 rounded-md p-1.5 text-zinc-600 transition-colors hover:text-red-400 disabled:opacity-40"
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}

export default function AccountModal({
  open,
  accounts,
  activeAccount,
  defaultUsername,
  sessionError,
  onClose,
  onOfflineLogin,
  onMicrosoftLogin,
  onSelect,
  onRemove,
}: AccountModalProps) {
  const [tab, setTab] = useState<"offline" | "microsoft">("offline");
  const [username, setUsername] = useState(defaultUsername);
  const [busy, setBusy] = useState(false);
  /** Key of the account currently being switched to, so only that row spins. */
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState("");
  /** With no saved accounts there is nothing to manage, so the modal opens
   * straight onto the sign-in form instead of an empty list. */
  const [addingAccount, setAddingAccount] = useState(accounts.length === 0);

  const activeKey = activeAccount ? accountKey(activeAccount) : null;
  const hasAccounts = accounts.length > 0;

  useEffect(() => {
    if (!open) return;
    setError("");
    setUsername(defaultUsername);
    setAddingAccount(accounts.length === 0);
  }, [open, defaultUsername, accounts.length]);

  const title = useMemo(() => {
    if (!hasAccounts) return "Sign in";
    return addingAccount ? "Add an account" : "Accounts";
  }, [hasAccounts, addingAccount]);

  async function run(action: () => Promise<void>, closeOnSuccess: boolean) {
    setError("");
    setBusy(true);
    try {
      await action();
      if (closeOnSuccess) onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleSelect(account: Account) {
    setSwitching(accountKey(account));
    await run(() => onSelect(account), true);
    setSwitching(null);
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="flex max-h-[80vh] w-[440px] flex-col rounded-2xl border border-border bg-bg-card p-5 shadow-2xl"
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex shrink-0 items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-zinc-100">{title}</h2>
                {hasAccounts && !addingAccount && (
                  <p className="text-xs text-zinc-500">
                    Saved on this PC - switching back never asks you to sign in again.
                  </p>
                )}
              </div>
              <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200">
                <X size={18} />
              </button>
            </div>

            {sessionError && (
              <p className="mb-3 flex shrink-0 items-start gap-1.5 rounded-lg border border-border bg-bg-elevated p-2.5 text-xs text-amber-400">
                <AlertTriangle size={13} className="mt-px shrink-0" />
                <span>{sessionError}</span>
              </p>
            )}

            {hasAccounts && !addingAccount && (
              <>
                <div className="-mr-1 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
                  {accounts.map((account) => {
                    const key = accountKey(account);
                    return (
                      <AccountRow
                        key={key}
                        account={account}
                        active={key === activeKey}
                        busy={switching === key}
                        disabled={busy}
                        onSelect={() => handleSelect(account)}
                        onRemove={() => run(() => onRemove(account), false)}
                      />
                    );
                  })}
                </div>

                <button
                  onClick={() => {
                    setError("");
                    setAddingAccount(true);
                  }}
                  className="mt-3 flex shrink-0 items-center justify-center gap-2 rounded-lg border border-dashed border-border-light py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:border-accent hover:text-accent"
                >
                  <Plus size={15} /> Add another account
                </button>
              </>
            )}

            {(addingAccount || !hasAccounts) && (
              <div className="flex shrink-0 flex-col">
                <div className="mb-4 flex gap-1 rounded-lg bg-bg-elevated p-1">
                  {(["offline", "microsoft"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setTab(t)}
                      className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${
                        tab === t ? "bg-accent text-accent-fg" : "text-zinc-400 hover:text-zinc-100"
                      }`}
                    >
                      {t === "offline" ? "Offline" : "Microsoft"}
                    </button>
                  ))}
                </div>

                {tab === "offline" ? (
                  <div className="flex flex-col gap-3">
                    <p className="text-xs text-zinc-500">
                      Play singleplayer, LAN, and offline-mode servers with a legally owned copy of
                      the game.
                    </p>
                    <input
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="Username"
                      className="rounded-lg border border-border-light bg-bg-elevated px-3 py-2 text-sm text-zinc-100 outline-none focus:border-accent"
                    />
                    <button
                      disabled={busy}
                      onClick={() => run(() => onOfflineLogin(username), true)}
                      className="flex items-center justify-center gap-2 rounded-lg bg-accent py-2.5 text-sm font-bold text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-50"
                    >
                      {busy && <Loader2 size={15} className="animate-spin" />}
                      Continue offline
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    <p className="text-xs text-zinc-500">
                      Opens a Microsoft sign-in window. Required for multiplayer, Realms, and
                      skins. Uses Mojang's own official client - no setup needed.
                    </p>
                    <button
                      disabled={busy}
                      onClick={() => run(onMicrosoftLogin, true)}
                      className="flex items-center justify-center gap-2 rounded-lg bg-accent py-2.5 text-sm font-bold text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-50"
                    >
                      {busy && <Loader2 size={15} className="animate-spin" />}
                      Sign in with Microsoft
                    </button>
                  </div>
                )}

                {hasAccounts && (
                  <button
                    onClick={() => {
                      setError("");
                      setAddingAccount(false);
                    }}
                    className="mt-3 text-xs text-zinc-500 hover:text-zinc-200"
                  >
                    Back to saved accounts
                  </button>
                )}
              </div>
            )}

            {error && <p className="mt-3 shrink-0 text-xs text-red-400">{error}</p>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
