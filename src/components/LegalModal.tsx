import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, FileText, Loader2, LogOut, ShieldCheck } from "lucide-react";
import AmethystLogo from "./AmethystLogo";
import { LEGAL_DOCS, LEGAL_UPDATED, type LegalDoc, type LegalDocId } from "../lib/legal";

/** The first-launch consent gate: it can't be dismissed, only accepted or
 * declined. */
interface LegalModalProps {
  open: boolean;
  onAccept: () => Promise<void>;
  onDecline: () => void;
}

const TABS: { id: LegalDocId; icon: typeof FileText }[] = [
  { id: "terms", icon: FileText },
  { id: "privacy", icon: ShieldCheck },
];

export default function LegalModal({ open, onAccept, onDecline }: LegalModalProps) {
  const [doc, setDoc] = useState<LegalDocId>("terms");
  /** Documents scrolled to the end - ticked on their tab. */
  const [read, setRead] = useState<Record<LegalDocId, boolean>>({ terms: false, privacy: false });
  const [progress, setProgress] = useState(0);
  const [agreed, setAgreed] = useState(false);
  const [confirmDecline, setConfirmDecline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const scroller = useRef<HTMLDivElement>(null);

  // Each document starts at the top; a short one counts as read straight away.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTop = 0;
    measure(el);
  }, [doc, open]);

  function measure(el: HTMLDivElement) {
    const max = el.scrollHeight - el.clientHeight;
    const p = max <= 0 ? 1 : el.scrollTop / max;
    setProgress(p);
    if (p > 0.97) setRead((r) => (r[doc] ? r : { ...r, [doc]: true }));
  }

  async function handleAccept() {
    setBusy(true);
    setError("");
    try {
      await onAccept();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const current = LEGAL_DOCS[doc];

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="legal-title"
            className="relative flex max-h-[86vh] w-full max-w-[680px] flex-col overflow-hidden rounded-2xl border border-border bg-bg-card shadow-2xl"
            initial={{ opacity: 0, scale: 0.95, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 14 }}
            transition={{ type: "spring", stiffness: 300, damping: 28 }}
          >
            {/* Accent glow behind the header */}
            <div className="pointer-events-none absolute -top-24 left-1/2 h-48 w-[480px] -translate-x-1/2 rounded-full bg-accent/15 blur-3xl" />

            <header className="relative flex shrink-0 items-start gap-4 px-6 pt-6">
              <AmethystLogo size={52} />
              <div className="min-w-0 flex-1">
                <h2 id="legal-title" className="text-lg font-semibold text-zinc-100">
                  Welcome to Amethyst Launcher
                </h2>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Before you start, please read and accept our Terms of Service and Privacy Policy.
                </p>
              </div>
            </header>

            <div className="relative mx-6 mt-5 flex shrink-0 rounded-xl bg-bg-elevated p-1">
              {TABS.map(({ id, icon: Icon }) => {
                const active = id === doc;
                return (
                  <button
                    key={id}
                    onClick={() => setDoc(id)}
                    className={`relative flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium transition-colors ${
                      active ? "text-accent-fg" : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId="legal-tab"
                        className="absolute inset-0 rounded-lg bg-accent"
                        transition={{ type: "spring", stiffness: 400, damping: 32 }}
                      />
                    )}
                    <span className="relative flex items-center gap-2">
                      <Icon size={14} />
                      {LEGAL_DOCS[id].title}
                      {read[id] && <Check size={13} strokeWidth={3} />}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="relative mx-6 mt-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-bg-elevated/60">
              <div className="h-0.5 shrink-0 bg-border">
                <div className="h-full bg-accent transition-[width] duration-150" style={{ width: `${progress * 100}%` }} />
              </div>
              <div
                ref={scroller}
                onScroll={(e) => measure(e.currentTarget)}
                className="min-h-0 flex-1 overflow-y-auto px-5 py-4"
              >
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={doc}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.15 }}
                  >
                    <DocBody doc={current} />
                  </motion.div>
                </AnimatePresence>
              </div>
              {/* Fades the text out at the bottom until the end is reached */}
              <div
                className={`pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-bg-elevated to-transparent transition-opacity ${
                  progress > 0.97 ? "opacity-0" : "opacity-100"
                }`}
              />
            </div>

            <footer className="relative shrink-0 px-6 pb-6 pt-4">
              <AnimatePresence mode="wait" initial={false}>
                {confirmDecline ? (
                  <motion.div
                    key="decline"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    className="flex items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3"
                  >
                    <p className="flex-1 text-xs text-zinc-300">
                      Amethyst Launcher can't be used without accepting. The launcher will close, and you'll be
                      asked again the next time you open it.
                    </p>
                    <button
                      onClick={() => setConfirmDecline(false)}
                      className="rounded-lg border border-border-light px-3 py-2 text-sm text-zinc-300 hover:border-accent hover:text-accent transition-colors"
                    >
                      Go back
                    </button>
                    <button
                      onClick={onDecline}
                      className="flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-500 transition-colors"
                    >
                      <LogOut size={14} /> Exit
                    </button>
                  </motion.div>
                ) : (
                  <motion.div
                    key="accept"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    className="flex flex-col gap-4"
                  >
                    <label className="flex cursor-pointer items-start gap-3 select-none">
                      <input
                        type="checkbox"
                        checked={agreed}
                        onChange={(e) => setAgreed(e.target.checked)}
                        className="peer sr-only"
                      />
                      <span
                        className={`mt-px flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-accent/50 ${
                          agreed ? "border-accent bg-accent text-accent-fg" : "border-border-light bg-bg-elevated"
                        }`}
                      >
                        {agreed && <Check size={12} strokeWidth={3.5} />}
                      </span>
                      <span className="text-xs leading-relaxed text-zinc-400">
                        I have read and agree to the{" "}
                        <button type="button" onClick={() => setDoc("terms")} className="text-accent hover:underline">
                          Terms of Service
                        </button>{" "}
                        and the{" "}
                        <button type="button" onClick={() => setDoc("privacy")} className="text-accent hover:underline">
                          Privacy Policy
                        </button>
                        .
                      </span>
                    </label>

                    <div className="flex items-center justify-end gap-2">
                      {error && <p className="mr-auto text-xs text-red-400">{error}</p>}
                      <button
                        onClick={() => setConfirmDecline(true)}
                        disabled={busy}
                        className="rounded-lg border border-border-light px-4 py-2.5 text-sm text-zinc-300 hover:border-red-500/60 hover:text-red-400 transition-colors disabled:opacity-50"
                      >
                        Decline
                      </button>
                      <button
                        onClick={handleAccept}
                        disabled={!agreed || busy}
                        className="flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-bold text-accent-fg hover:bg-accent-hover transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} strokeWidth={3} />}
                        Accept & continue
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function DocBody({ doc }: { doc: LegalDoc }) {
  return (
    <article className="flex flex-col gap-5">
      <div className="flex items-start gap-3 rounded-lg border border-accent/25 bg-accent/5 p-3">
        <span className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-accent">TL;DR</span>
        <p className="text-xs leading-relaxed text-zinc-300">{doc.summary}</p>
      </div>
      {doc.sections.map((section) => (
        <section key={section.heading}>
          <h3 className="mb-1.5 text-sm font-semibold text-zinc-100">{section.heading}</h3>
          <div className="flex flex-col gap-1.5">
            {section.body.map((para, i) =>
              para.startsWith("- ") ? (
                <p key={i} className="flex gap-2 pl-1 text-xs leading-relaxed text-zinc-400">
                  <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-accent" />
                  <span>{para.slice(2)}</span>
                </p>
              ) : (
                <p key={i} className="text-xs leading-relaxed text-zinc-400">
                  {para}
                </p>
              )
            )}
          </div>
        </section>
      ))}
      <p className="border-t border-border pt-3 text-[11px] text-zinc-500">Last updated {LEGAL_UPDATED}.</p>
    </article>
  );
}
