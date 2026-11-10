"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readConfirmationRedirect } from "../../lib/cloud-core.ts";
import { AccountEvidencePanel } from "./account-evidence-panel";
import { PerformancePanel } from "./performance-panel";
import { MarketOverview } from "./market-overview";
import {
  BITGET_CONNECTION_EVENT,
  BitgetConnectionPanel,
  type BitgetConnectionView,
} from "./bitget-connection-panel";
import { BtccAccountPanel } from "./btcc-account-panel";

type ProviderKind = "exchange" | "wallet" | "network" | "identity" | "terminal";
type Provider = {
  id: string;
  name: string;
  kind: ProviderKind;
  description: string;
  state: "not-connected" | "connected" | "verified-once";
  note: string;
};
type Activity = { id: string; at: string; title: string; detail: string };
type CloudSession = {
  configured: boolean;
  authenticated: boolean;
  user?: { id: string; email?: string } | null;
  error?: string;
};
type WalletAddresses = { phantom?: string; metamask?: string; base?: string };
type BitgetVerification = {
  verifiedAt: string;
  accountEquityUsd: number | null;
  usdtEquity: number | null;
  btcEquity: number | null;
};
type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};
type PhantomProvider = {
  connect: () => Promise<{ publicKey?: { toString: () => string } }>;
  publicKey?: { toString: () => string };
  isConnected?: boolean;
};

const starterProviders: Provider[] = [
  {
    id: "btcc",
    name: "BTCC",
    kind: "exchange",
    description: "Read-only status and owner-imported balances, positions and copy history.",
    state: "not-connected",
    note: "The BTCC futures API is suspended, so no live connection exists. Import your own BTCC CSV exports in Accounts; they are labelled owner-imported, not live. Do not enter BTCC credentials here.",
  },
  {
    id: "bitget",
    name: "Bitget",
    kind: "exchange",
    description: "Live read-only balances and positions through the official API.",
    state: "not-connected",
    note: "Save a read-only Bitget API key after sign-in. It is encrypted on the GEM server and never stored in this browser.",
  },
  {
    id: "phantom",
    name: "Phantom",
    kind: "wallet",
    description: "Solana wallet visibility.",
    state: "not-connected",
    note: "Connect Phantom to verify the active public wallet address. No signature or transaction is requested.",
  },
  {
    id: "metamask",
    name: "MetaMask",
    kind: "wallet",
    description: "EVM wallet visibility.",
    state: "not-connected",
    note: "Connect MetaMask to verify the active public wallet address. No signature or transaction is requested.",
  },
  {
    id: "base",
    name: "Base",
    kind: "network",
    description: "Base network assets and wallet activity.",
    state: "not-connected",
    note: "Use MetaMask to select Base mainnet and verify the connected address. No transaction is submitted.",
  },
  {
    id: "farcaster",
    name: "Farcaster",
    kind: "identity",
    description: "Social identity and public profile context.",
    state: "not-connected",
    note: "Identity linking is not implemented in this release.",
  },
  {
    id: "mt5",
    name: "MetaTrader 5",
    kind: "terminal",
    description: "External trading terminal / broker account.",
    state: "not-connected",
    note: "Broker integration is not implemented in this release.",
  },
];

const nav = [
  { id: "overview", label: "Home", icon: "⌂" },
  { id: "providers", label: "Accounts", icon: "⛓" },
  { id: "portfolio", label: "Positions", icon: "▤" },
  { id: "performance", label: "Performance", icon: "↗" },
  { id: "risk", label: "Limits", icon: "◈" },
  { id: "activity", label: "Activity", icon: "≡" },
  { id: "settings", label: "Settings", icon: "⚙" },
] as const;
type View = (typeof nav)[number]["id"];

function money(value: number) {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

function WorkspaceIcon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    overview: "M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z",
    providers: "M8 3h8v5H8z M8 16h8v5H8z M12 8v8 M3 12h18",
    portfolio: "M3 6h18v15H3z M8 6V3h8v3 M3 11h18 M10 14h4",
    performance: "M3 17l6-6 4 4 7-9 M15 6h5v5 M3 21h18",
    risk: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z M8 12l3 3 5-6",
    settings:
      "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2",
    account: "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M4 21v-2a8 8 0 0 1 16 0v2",
    traders:
      "M15 21v-2a6 6 0 0 0-12 0v2 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M17 3a4 4 0 0 1 0 8 M21 21v-2a6 6 0 0 0-4-5",
  };
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] || paths.overview} />
    </svg>
  );
}

export function CopyCenterWorkspace({
  accountOnly = false,
  initialAuthMode = "signin",
}: { accountOnly?: boolean; initialAuthMode?: "signin" | "signup" } = {}) {
  const [view, setView] = useState<View>(accountOnly ? "settings" : "overview");
  const [providers, setProviders] = useState<Provider[]>(starterProviders);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [budget, setBudget] = useState("10");
  const [maxLoss, setMaxLoss] = useState("2");
  const [selected, setSelected] = useState<Provider | null>(null);
  const [toast, setToast] = useState("");
  const [storageReady, setStorageReady] = useState(false);
  const [walletAddresses, setWalletAddresses] = useState<WalletAddresses>({});
  const [cloudSession, setCloudSession] = useState<CloudSession>({
    configured: false,
    authenticated: false,
    user: null,
  });
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudMessage, setCloudMessage] = useState("");
  const [cloudEmail, setCloudEmail] = useState("");
  const [cloudPassword, setCloudPassword] = useState("");
  const [authMode, setAuthMode] = useState<"signin" | "signup">(
    initialAuthMode,
  );
  const [cloudUpdatedAt, setCloudUpdatedAt] = useState<string | null>(null);
  useEffect(() => {
    if (!accountOnly || !cloudSession.authenticated) return;
    let active = true;
    void fetch("/api/auth/owner", { cache: "no-store" })
      .then(async (response) => {
        if (!active) return;
        if (response.ok) window.location.replace("/copy-center");
        else
          setCloudMessage(
            response.status === 403
              ? "This signed-in account does not have owner workspace access. Sign out to use your owner account."
              : "Owner access could not be verified. Try again shortly.",
          );
      })
      .catch(() => {
        if (active)
          setCloudMessage(
            "Owner access could not be reached. Try again shortly.",
          );
      });
    return () => {
      active = false;
    };
  }, [accountOnly, cloudSession.authenticated]);

  const [bgKey, setBgKey] = useState("");
  const [bgSecret, setBgSecret] = useState("");
  const [bgPhrase, setBgPhrase] = useState("");
  const [bgMessage, setBgMessage] = useState("");
  const [bgResult, setBgResult] = useState<BitgetVerification | null>(null);
  const [bgBusy, setBgBusy] = useState(false);
  const onBitgetStatus = useCallback(
    (connection: BitgetConnectionView | null) => {
      setProviders((old) =>
        old.map((p) => {
          if (p.id !== "bitget") return p;
          if (connection && connection.status === "READ_ONLY")
            return {
              ...p,
              state: "connected",
              note:
                "Read-only connection saved" +
                (connection.lastVerifiedAt
                  ? "; last verified " +
                    new Date(connection.lastVerifiedAt).toLocaleString()
                  : "") +
                ". Credentials are encrypted on the server.",
            };
          if (connection && connection.status === "ERROR")
            return {
              ...p,
              state: "not-connected",
              note: "The saved Bitget connection needs attention. Review it in Accounts.",
            };
          return p.state === "connected"
            ? { ...p, state: "not-connected", note: starterProviders.find((x) => x.id === "bitget")!.note }
            : p;
        }),
      );
    },
    [],
  );
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requested = accountOnly ? "settings" : params.get("view");
    if (requested && nav.some((item) => item.id === requested))
      setView(requested as View);
    if (requested === "settings" && params.get("auth") === "signup")
      setAuthMode("signup");
  }, []);
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [view]);
  const modalRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!selected) return;
    const previous = document.activeElement as HTMLElement | null;
    const modal = modalRef.current;
    const focusable = () =>
      Array.from(
        modal?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), a[href], input:not(:disabled), summary",
        ) ?? [],
      );
    focusable()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setSelected(null);
      }
      if (event.key !== "Tab") return;
      const elements = focusable();
      const first = elements[0],
        last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [selected]);

  useEffect(() => {
    // Confirmation links return here. Never retain their tokens in the address bar
    // or treat a callback token as a signed-in app session.
    const hash = window.location.hash;
    const outcome = readConfirmationRedirect(hash);
    const params = new URLSearchParams(hash.replace(/^#/, ""));
    if (
      params.has("access_token") ||
      params.has("refresh_token") ||
      params.has("error") ||
      params.has("error_code")
    ) {
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
    }
    if (!outcome) return;
    setAuthMode("signin");
    setView("settings");
    setCloudMessage(
      outcome.kind === "confirmed"
        ? "Email confirmation link received. Sign in with your email and password to access your cloud workspace."
        : outcome.message,
    );
  }, []);

  // Bitget connection state always comes from the server, never browser storage.
  useEffect(() => {
    if (!cloudSession.authenticated) return;
    const controller = new AbortController();
    void fetch("/api/connections/bitget", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data && data.ok === true) onBitgetStatus(data.connection ?? null);
      })
      .catch(() => {
        /* Status stays "not connected"; nothing is inferred. */
      });
    return () => controller.abort();
  }, [cloudSession.authenticated, onBitgetStatus]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("gem-copy-center-workspace-v1");
      if (raw) {
        const saved = JSON.parse(raw) as {
          providers?: Provider[];
          activity?: Activity[];
          budget?: string;
          maxLoss?: string;
        };
        if (saved.providers)
          setProviders(
            starterProviders.map((base) => {
              const prior = saved.providers!.find((p) => p.id === base.id);
              return { ...base, state: "not-connected" };
            }),
          );
        if (Array.isArray(saved.activity))
          setActivity(
            saved.activity
              .filter(
                (item) =>
                  item &&
                  typeof item.id === "string" &&
                  typeof item.title === "string" &&
                  typeof item.detail === "string" &&
                  !Number.isNaN(Date.parse(item.at)),
              )
              .slice(0, 50),
          );
        if (
          typeof saved.budget === "string" &&
          Number.isFinite(Number(saved.budget)) &&
          Number(saved.budget) >= 0 &&
          Number(saved.budget) <= 100000
        )
          setBudget(saved.budget);
        if (
          typeof saved.maxLoss === "string" &&
          Number.isFinite(Number(saved.maxLoss)) &&
          Number(saved.maxLoss) >= 0 &&
          Number(saved.maxLoss) <= 100
        )
          setMaxLoss(saved.maxLoss);
      }
      const rawWallets = localStorage.getItem(
        "gem-copy-center-wallet-addresses-v1",
      );
      if (rawWallets) {
        const wallets = JSON.parse(rawWallets) as WalletAddresses;
        setWalletAddresses({
          ...(typeof wallets.phantom === "string"
            ? { phantom: wallets.phantom }
            : {}),
          ...(typeof wallets.metamask === "string"
            ? { metamask: wallets.metamask }
            : {}),
          ...(typeof wallets.base === "string" ? { base: wallets.base } : {}),
        });
      }
    } catch {
      /* Start with a safe blank workspace if saved data is invalid. */
    }
    setStorageReady(true);
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    try {
      localStorage.setItem(
        "gem-copy-center-workspace-v1",
        JSON.stringify({
          providers,
          activity: activity.slice(0, 50),
          budget,
          maxLoss,
        }),
      );
      localStorage.setItem(
        "gem-copy-center-wallet-addresses-v1",
        JSON.stringify(walletAddresses),
      );
    } catch {
      setToast("This browser could not save workspace changes.");
    }
  }, [providers, activity, budget, maxLoss, walletAddresses, storageReady]);

  useEffect(() => {
    let active = true;
    void fetch("/api/auth/session", {
      cache: "no-store",
      credentials: "same-origin",
    })
      .then(async (response) => ({
        response,
        data: await response.json().catch(() => ({})),
      }))
      .then(({ response, data }) => {
        if (!active) return;
        setCloudSession({
          configured: data.configured === true,
          authenticated: data.authenticated === true,
          user: data.user ?? null,
          ...(typeof data.error === "string" ? { error: data.error } : {}),
        });
        if (!response.ok || data.error)
          setCloudMessage(
            data.error || "Cloud account status could not be checked.",
          );
      })
      .catch(() => {
        if (active)
          setCloudMessage(
            "Cloud account status is temporarily unavailable. Local planning data is still available.",
          );
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    let active = true;
    const verifyWallets = async () => {
      const w = window as Window & {
        ethereum?: EthereumProvider;
        phantom?: { solana?: PhantomProvider };
      };
      const verified: Record<string, string> = {};
      try {
        if (walletAddresses.metamask && w.ethereum) {
          const accounts = (await w.ethereum.request({
            method: "eth_accounts",
          })) as string[];
          if (
            Array.isArray(accounts) &&
            accounts.some(
              (a) =>
                a.toLowerCase() === walletAddresses.metamask!.toLowerCase(),
            )
          )
            verified.metamask = accounts.find(
              (a) =>
                a.toLowerCase() === walletAddresses.metamask!.toLowerCase(),
            )!;
        }
      } catch {
        /* Wallet extension is locked or unavailable; never trust stale local state. */
      }
      try {
        if (walletAddresses.base && w.ethereum) {
          const chainId = await w.ethereum.request({ method: "eth_chainId" });
          const accounts = (await w.ethereum.request({
            method: "eth_accounts",
          })) as string[];
          if (
            chainId === "0x2105" &&
            Array.isArray(accounts) &&
            accounts.some(
              (a) => a.toLowerCase() === walletAddresses.base!.toLowerCase(),
            )
          )
            verified.base = accounts.find(
              (a) => a.toLowerCase() === walletAddresses.base!.toLowerCase(),
            )!;
        }
      } catch {
        /* Base is not active in this wallet session. */
      }
      try {
        const phantom = w.phantom?.solana;
        const address = phantom?.publicKey?.toString();
        if (
          phantom?.isConnected &&
          address &&
          walletAddresses.phantom === address
        )
          verified.phantom = address;
      } catch {
        /* Phantom is not connected in this wallet session. */
      }
      if (!active) return;
      setProviders((old) =>
        old.map((p) => {
          const address = verified[p.id as keyof typeof verified];
          return ["phantom", "metamask", "base"].includes(p.id)
            ? {
                ...p,
                state: address ? "connected" : "not-connected",
                note: address
                  ? "Wallet session verified: " +
                    address.slice(0, 7) +
                    "…" +
                    address.slice(-5)
                  : starterProviders.find((s) => s.id === p.id)!.note,
              }
            : p;
        }),
      );
    };
    void verifyWallets();
    return () => {
      active = false;
    };
  }, [storageReady, walletAddresses]);

  const connectedCount = providers.filter(
    (p) => p.state === "connected",
  ).length;
  const exchangeCount = providers.filter(
    (p) => p.kind === "exchange" && p.state === "connected",
  ).length;
  const budgetValue = Math.max(0, Number(budget) || 0);
  const lossValue = Math.max(0, Number(maxLoss) || 0);
  const perProviderRisk = useMemo(
    () => (budgetValue * lossValue) / 100,
    [budgetValue, lossValue],
  );

  function log(title: string, detail: string) {
    setActivity((old) =>
      [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          title,
          detail,
        },
        ...old,
      ].slice(0, 50),
    );
  }
  function requestConnection(provider: Provider) {
    setSelected(provider);
    setToast("");
  }
  function confirmNotConnected(provider: Provider) {
    log("Connection setup reviewed", provider.name + ": " + provider.note);
    setSelected(null);
    setToast(
      provider.name +
        " is still marked not connected. No account was accessed.",
    );
  }

  async function refreshCloudSession() {
    const response = await fetch("/api/auth/session", {
      cache: "no-store",
      credentials: "same-origin",
    });
    const data = await response.json().catch(() => ({}));
    setCloudSession({
      configured: data.configured === true,
      authenticated: data.authenticated === true,
      user: data.user ?? null,
      ...(typeof data.error === "string" ? { error: data.error } : {}),
    });
    return data as CloudSession;
  }

  async function cloudAuth(action: "login" | "signup" | "resend" | "logout") {
    if (cloudBusy) return;
    setCloudBusy(true);
    setCloudMessage("");
    try {
      const endpoint =
        action === "logout"
          ? "/api/auth/logout"
          : action === "resend"
            ? "/api/auth/resend"
            : "/api/auth/" + action;
      const payload =
        action === "logout"
          ? {}
          : action === "resend"
            ? { email: cloudEmail }
            : { email: cloudEmail, password: cloudPassword };
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.error)
        throw new Error(
          typeof data.error === "string"
            ? data.error
            : "The account request did not complete.",
        );
      if (action === "logout") {
        setCloudUpdatedAt(null);
        setCloudPassword("");
        setCloudSession({ configured: true, authenticated: false, user: null });
        setCloudMessage(
          "Signed out. Cloud data remains saved in your account.",
        );
        window.location.assign("/sign-in");
      } else if (action === "signup" && data.needsEmailConfirmation) {
        setCloudMessage(
          typeof data.message === "string"
            ? data.message
            : "Check your email for a confirmation link, then sign in.",
        );
      } else if (action === "resend") {
        setCloudMessage(
          typeof data.message === "string"
            ? data.message
            : "If the account needs confirmation, a new email was requested. Delivery is not guaranteed.",
        );
      } else {
        await refreshCloudSession();
        setCloudUpdatedAt(null);
        setCloudPassword("");
        setCloudMessage(
          action === "signup"
            ? "Account created and signed in."
            : "Signed in. Use Restore cloud data or Save to cloud to sync this workspace.",
        );
      }
    } catch (error) {
      setCloudMessage(
        error instanceof Error
          ? error.message
          : "Cloud account request failed.",
      );
    } finally {
      setCloudBusy(false);
    }
  }

  async function syncCloud(mode: "save" | "restore") {
    if (cloudBusy) return;
    setCloudBusy(true);
    setCloudMessage("");
    try {
      const get = await fetch("/api/workspace", {
        cache: "no-store",
        credentials: "same-origin",
      });
      const current = await get.json().catch(() => ({}));
      if (!get.ok)
        throw new Error(
          typeof current.error === "string"
            ? current.error
            : "Sign in to use cloud sync.",
        );
      if (mode === "restore") {
        if (!current.workspace?.copyCenter)
          throw new Error(
            "There are no saved Copy Center preferences in the cloud account yet.",
          );
        const saved = current.workspace.copyCenter as {
          budget?: unknown;
          maxLoss?: unknown;
          activity?: unknown[];
          walletAddresses?: unknown;
        };
        if (
          typeof saved.budget !== "string" ||
          typeof saved.maxLoss !== "string" ||
          !Array.isArray(saved.activity)
        )
          throw new Error(
            "The saved Copy Center settings are invalid; local data was not changed.",
          );
        setBudget(saved.budget);
        setMaxLoss(saved.maxLoss);
        if (
          saved.walletAddresses &&
          typeof saved.walletAddresses === "object" &&
          !Array.isArray(saved.walletAddresses)
        ) {
          const candidate = saved.walletAddresses as Record<string, unknown>;
          setWalletAddresses({
            ...(typeof candidate.phantom === "string"
              ? { phantom: candidate.phantom }
              : {}),
            ...(typeof candidate.metamask === "string"
              ? { metamask: candidate.metamask }
              : {}),
            ...(typeof candidate.base === "string"
              ? { base: candidate.base }
              : {}),
          });
        } else {
          setWalletAddresses({});
        }
        setActivity(
          saved.activity
            .filter((item): item is Activity =>
              Boolean(
                item &&
                  typeof item === "object" &&
                  typeof (item as Activity).id === "string" &&
                  typeof (item as Activity).at === "string" &&
                  typeof (item as Activity).title === "string" &&
                  typeof (item as Activity).detail === "string",
              ),
            )
            .slice(0, 50),
        );
        setCloudUpdatedAt(
          typeof current.updatedAt === "string" ? current.updatedAt : null,
        );
        setCloudMessage(
          "Cloud preferences restored. Wallet sessions must be re-verified in this browser.",
        );
      } else {
        if (cloudUpdatedAt !== null && current.updatedAt !== cloudUpdatedAt)
          throw new Error(
            "Cloud records changed in another session. Your local records were kept. Restore and compare before saving.",
          );
        if (
          cloudUpdatedAt === null &&
          current.workspace &&
          !window.confirm(
            "A saved workspace already exists. Replace its Copy Center preferences with this browser's preferences? Trader research records will be preserved.",
          )
        )
          return;
        const base =
          current.workspace && typeof current.workspace === "object"
            ? current.workspace
            : { traders: [], savedReviews: [], portfolioSnapshots: [] };
        const response = await fetch("/api/workspace", {
          method: "PUT",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedUpdatedAt: cloudUpdatedAt ?? current.updatedAt ?? null,
            workspace: {
              ...base,
              copyCenter: {
                budget,
                maxLoss,
                activity: activity.slice(0, 50),
                walletAddresses,
              },
            },
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result.error)
          throw new Error(
            typeof result.error === "string"
              ? result.error
              : "Cloud save failed.",
          );
        setCloudUpdatedAt(
          typeof result.updatedAt === "string"
            ? result.updatedAt
            : new Date().toISOString(),
        );
        setCloudMessage(
          "Workspace saved to your authenticated cloud account. Exchange credentials and wallet secrets are not uploaded.",
        );
      }
    } catch (error) {
      setCloudMessage(
        error instanceof Error ? error.message : "Cloud sync failed.",
      );
    } finally {
      setCloudBusy(false);
    }
  }

  async function saveBitget() {
    setBgBusy(true);
    setBgMessage("");
    setBgResult(null);
    try {
      if (!cloudSession.authenticated)
        throw new Error("Sign in first to connect an exchange account.");
      const response = await fetch("/api/connections/bitget", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: bgKey,
          secret: bgSecret,
          passphrase: bgPhrase,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok !== true)
        throw new Error(
          typeof data.error === "string"
            ? data.error
            : "Bitget connection failed.",
        );
      onBitgetStatus(data.connection ?? null);
      window.dispatchEvent(new Event(BITGET_CONNECTION_EVENT));
      window.dispatchEvent(new Event("gem:account-evidence-changed"));
      log(
        "Bitget connected (read-only)",
        "Read-only permissions verified; balances read. Credentials are encrypted on the server. No order or transfer endpoint exists.",
      );
      setBgMessage(
        "Read-only connection saved. Balances and positions are shown in Accounts and Positions; use Re-verify & refresh any time.",
      );
    } catch (error) {
      setBgMessage(
        error instanceof Error ? error.message : "Connection failed.",
      );
    } finally {
      setBgKey("");
      setBgSecret("");
      setBgPhrase("");
      setBgBusy(false);
    }
  }

  async function verifyBitget() {
    setBgBusy(true);
    setBgMessage("");
    setBgResult(null);
    try {
      if (!cloudSession.authenticated)
        throw new Error("Sign in first to verify an exchange connection.");
      const response = await fetch("/api/connections/bitget/verify", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: bgKey,
          secret: bgSecret,
          passphrase: bgPhrase,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok !== true)
        throw new Error(
          typeof data.error === "string"
            ? data.error
            : "Bitget verification failed.",
        );
      setBgResult({
        verifiedAt:
          typeof data.verifiedAt === "string"
            ? data.verifiedAt
            : new Date().toISOString(),
        accountEquityUsd:
          typeof data.accountEquityUsd === "number" &&
          Number.isFinite(data.accountEquityUsd)
            ? data.accountEquityUsd
            : null,
        usdtEquity:
          typeof data.usdtEquity === "number" &&
          Number.isFinite(data.usdtEquity)
            ? data.usdtEquity
            : null,
        btcEquity:
          typeof data.btcEquity === "number" && Number.isFinite(data.btcEquity)
            ? data.btcEquity
            : null,
      });
      setProviders((old) =>
        old.map((p) =>
          p.id === "bitget"
            ? {
                ...p,
                state: "verified-once",
                note:
                  "Read-only API verified once at " +
                  new Date().toLocaleString() +
                  ". Credentials were not saved; no recurring sync is active.",
              }
            : p,
        ),
      );
      log(
        "Bitget verified",
        "Read-only account-assets endpoint succeeded. No order or transfer endpoint was called.",
      );
      setBgMessage(
        "Read-only verification succeeded. Credentials were not saved; re-enter them for the next check.",
      );
    } catch (error) {
      setBgMessage(
        error instanceof Error ? error.message : "Verification failed.",
      );
    } finally {
      setBgKey("");
      setBgSecret("");
      setBgPhrase("");
      setBgBusy(false);
    }
  }

  async function connectWallet(provider: Provider) {
    const w = window as Window & {
      ethereum?: EthereumProvider;
      phantom?: { solana?: PhantomProvider };
    };
    setToast("");
    try {
      let address = "";
      if (provider.id === "phantom") {
        const phantom = w.phantom?.solana;
        if (!phantom) {
          setToast(
            "Phantom was not detected. Install it from phantom.app, then return and retry.",
          );
          return;
        }
        const result = await phantom.connect();
        address =
          result.publicKey?.toString() || phantom.publicKey?.toString() || "";
      } else if (provider.id === "metamask") {
        if (!w.ethereum) {
          setToast(
            "No EVM wallet was detected. Install MetaMask, then return and retry.",
          );
          return;
        }
        const accounts = (await w.ethereum.request({
          method: "eth_requestAccounts",
        })) as string[];
        address = Array.isArray(accounts) ? accounts[0] || "" : "";
      } else if (provider.id === "base") {
        if (!w.ethereum) {
          setToast(
            "No EVM wallet was detected. Install MetaMask, then return and retry.",
          );
          return;
        }
        const accounts = (await w.ethereum.request({
          method: "eth_requestAccounts",
        })) as string[];
        address = Array.isArray(accounts) ? accounts[0] || "" : "";
        if (!address) throw new Error("The wallet did not return an account.");
        try {
          await w.ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: "0x2105" }],
          });
        } catch (switchError) {
          if ((switchError as { code?: number })?.code !== 4902)
            throw switchError;
          await w.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: "0x2105",
                chainName: "Base",
                nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
                rpcUrls: ["https://mainnet.base.org"],
                blockExplorerUrls: ["https://basescan.org"],
              },
            ],
          });
        }
        const chainId = await w.ethereum.request({ method: "eth_chainId" });
        if (chainId !== "0x2105")
          throw new Error("Base mainnet was not selected in the wallet.");
      } else {
        setToast(
          provider.name +
            " does not have a verified connection adapter yet. No credentials were sent.",
        );
        return;
      }
      if (!address)
        throw new Error("The wallet did not return a public address.");
      const nextWallets = { ...walletAddresses, [provider.id]: address };
      setWalletAddresses(nextWallets);
      setProviders((old) =>
        old.map((p) =>
          p.id === provider.id
            ? {
                ...p,
                state: "connected",
                note:
                  "Wallet session verified: " +
                  address.slice(0, 7) +
                  "…" +
                  address.slice(-5),
              }
            : p,
        ),
      );
      log(
        "Wallet connected",
        provider.name +
          " public address verified: " +
          address.slice(0, 7) +
          "…" +
          address.slice(-5) +
          ". No signature or transaction was requested.",
      );
      setSelected(null);
      setToast(
        provider.name +
          " wallet session verified. No transaction was submitted.",
      );
    } catch (error) {
      setToast(
        error instanceof Error
          ? error.message
          : "Wallet connection failed. No transaction was submitted.",
      );
    }
  }

  const mainNav = nav.filter((item) =>
    ["overview", "providers", "portfolio", "performance", "risk"].includes(
      item.id,
    ),
  );
  const renderProvider = (provider: Provider) => (
    <article className="cc-provider-card" key={provider.id}>
      <div className="cc-provider-top">
        <span className={"cc-provider-icon cc-icon-" + provider.kind}>
          {provider.name.slice(0, 1)}
        </span>
        <span
          className={
            "cc-pill " +
            (provider.state !== "not-connected"
              ? "cc-pill-safe"
              : "cc-pill-off")
          }
        >
          {provider.state === "connected"
            ? "Verified session"
            : provider.state === "verified-once"
              ? "Verified once"
              : provider.id === "btcc"
                ? "Guide only"
                : "Not connected"}
        </span>
      </div>
      <h3>{provider.name}</h3>
      <p className="cc-provider-description">{provider.description}</p>
      <button
        className="cc-card-button"
        onClick={() => requestConnection(provider)}
      >
        {provider.id === "bitget"
          ? "Check read-only access"
          : provider.id === "btcc"
            ? "Review BTCC connection"
            : "Connect wallet"}
        <span aria-hidden="true">→</span>
      </button>
    </article>
  );

  return (
    <div className="cc-shell">
      <a className="cc-skip" href="#cc-content">
        Skip to content
      </a>
      {!accountOnly && (
        <aside className="cc-sidebar" aria-label="Main navigation">
          <a className="cc-brand" href="/copy-center">
            <span className="cc-mark">G</span>
            <span>
              <strong>GEM</strong>
              <small>Copy Center</small>
            </span>
          </a>
          <nav>
            {mainNav.map((item) => (
              <button
                key={item.id}
                aria-current={view === item.id ? "page" : undefined}
                className={view === item.id ? "active" : ""}
                onClick={() => setView(item.id)}
              >
                <WorkspaceIcon name={item.id} />
                {item.label}
              </button>
            ))}
          </nav>
          <div className="cc-sidebar-bottom">
            <button
              className={
                "cc-nav-setting " + (view === "settings" ? "active" : "")
              }
              onClick={() => setView("settings")}
            >
              <WorkspaceIcon name="settings" />
              Settings
            </button>
            <div className="cc-side-note">
              <span className="cc-status-dot" />
              <span>
                Trading status
                <small>Verify account permissions before live actions</small>
              </span>
            </div>
            <div className="cc-cross-links" aria-label="Related dashboards">
              <a href="/copy-trading">Trader intelligence</a>
              <a href="/opportunities">Opportunities</a>
              <a href="/automation">Automation center</a>
              <a href="/steel">Browser controls</a>
            </div>
          </div>
        </aside>
      )}
      <main
        className="cc-main"
        style={
          accountOnly
            ? {
                marginLeft: 0,
                maxWidth: 780,
                marginRight: "auto",
                marginInline: "auto",
              }
            : undefined
        }
        id="cc-content"
        tabIndex={-1}
      >
        <header className="cc-topbar">
          <div>
            <p className="cc-eyebrow">
              {accountOnly ? "PRIVATE WORKSPACE" : "YOUR WORKSPACE"}
            </p>
            <h1>
              {accountOnly
                ? authMode === "signup"
                  ? "Create account"
                  : "Sign in"
                : nav.find((item) => item.id === view)?.label}
            </h1>
          </div>
          {!accountOnly && (
            <button
              className="cc-account-button"
              onClick={() => setView("settings")}
            >
              <WorkspaceIcon name="account" />
              <span>
                {cloudSession.authenticated ? "My account" : "Sign in / Join"}
              </span>
            </button>
          )}
        </header>
        {!accountOnly && (
          <div className="cc-mode-bar">
            <span className="cc-status-dot" />
            <strong>Connection status</strong>
            <span>
              {exchangeCount
                ? "Exchange access checked; trading permissions not enabled"
                : "No active exchange trading session"}
            </span>
          </div>
        )}
        {!accountOnly && (
          <nav className="cc-mobile-nav" aria-label="Mobile navigation">
            {mainNav.map((item) => (
              <button
                key={item.id}
                aria-current={view === item.id ? "page" : undefined}
                className={view === item.id ? "active" : ""}
                onClick={() => setView(item.id)}
              >
                <WorkspaceIcon name={item.id} />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
        )}
        {toast && (
          <div className="cc-toast" role="status">
            <span>{toast}</span>
            <button onClick={() => setToast("")} aria-label="Dismiss">
              ×
            </button>
          </div>
        )}
        {!accountOnly && view === "overview" && (
          <div className="cc-page">
            <section className="cc-welcome">
              <div>
                <span className="cc-hero-label">
                  YOUR TRADING CONTROL CENTER
                </span>
                <h2>
                  Your accounts.
                  <br />
                  One simple workspace.
                </h2>
                <p>
                  Connect supported accounts, monitor activity, compare traders,
                  and track performance from one place.
                </p>
                <button
                  className="cc-button"
                  onClick={() => setView("providers")}
                >
                  Connect account <span aria-hidden="true">→</span>
                </button>
              </div>
              <div className="cc-hero-summary">
                <span className="cc-summary-symbol" aria-hidden="true">
                  <WorkspaceIcon name="providers" />
                </span>
                <span>Verified connections</span>
                <strong>{connectedCount}</strong>
                <span>
                  {connectedCount
                    ? "Review each account’s status"
                    : "Ready when you are"}
                </span>
                <div className="cc-summary-line">
                  <span className="cc-status-dot" /> Your approval stays in your
                  hands
                </div>
              </div>
            </section>
            <section className="cc-stats" aria-label="Workspace summary">
              <article>
                <span>Planning amount</span>
                <strong>
                  {money(budgetValue)}
                  <small> / provider</small>
                </strong>
                <p>Not a deposit or account balance</p>
              </article>
              <article>
                <span>Planned loss threshold</span>
                <strong>{lossValue}%</strong>
                <p>Planning only · not an exchange stop</p>
              </article>
              <article>
                <span>Workspace storage</span>
                <strong className="cc-stat-word">
                  {cloudSession.authenticated
                    ? "Cloud available"
                    : "This browser"}
                </strong>
                <button
                  className="cc-text-button"
                  onClick={() => setView("settings")}
                >
                  {cloudSession.authenticated
                    ? "Save or restore →"
                    : "Create a free account →"}
                </button>
              </article>
            </section>
            <section className="cc-section-head">
              <div>
                <h2>Manage your trading</h2>
                <p className="cc-lead">
                  Live account information and portfolio controls in one place.
                </p>
              </div>
            </section>
            <section className="cc-step-grid">
              <a href="/copy-center/positions">
                <WorkspaceIcon name="portfolio" />
                <strong>Positions and approvals</strong>
                <p>Inspect position records and approval requests.</p>
                <span className="cc-step-link">Open positions →</span>
              </a>
              <button onClick={() => setView("risk")}>
                <WorkspaceIcon name="risk" />
                <strong>Set your limits</strong>
                <p>Choose your planning amount and loss threshold.</p>
                <span className="cc-step-link">Review limits →</span>
              </button>
              <button onClick={() => setView("performance")}>
                <WorkspaceIcon name="portfolio" />
                <strong>Performance</strong>
                <p>Inspect recorded account equity and return evidence.</p>
                <span className="cc-step-link">Open performance →</span>
              </button>
              <a href="/automation">
                <WorkspaceIcon name="performance" />
                <strong>Automation center</strong>
                <p>
                  Review running checks, risk alerts, and service connectivity.
                </p>
                <span className="cc-step-link">Open automation →</span>
              </a>
              <a href="/opportunities">
                <WorkspaceIcon name="traders" />
                <strong>Opportunities</strong>
                <p>
                  Monitor candidates backed by verified market and trader data.
                </p>
                <span className="cc-step-link">View opportunities →</span>
              </a>
              <a href="/copy-trading">
                <WorkspaceIcon name="traders" />
                <strong>Trader intelligence</strong>
                <p>Compare trader metrics and risk-adjusted candidates.</p>
                <span className="cc-step-link">View traders →</span>
              </a>
            </section>
            {!cloudSession.authenticated && (
              <section className="cc-next-step">
                <span className="cc-next-icon">
                  <WorkspaceIcon name="account" />
                </span>
                <div>
                  <h3>Keep your plan across devices</h3>
                  <p>
                    Create your GEM account, then save your workspace to the
                    cloud.
                  </p>
                </div>
                <button
                  className="cc-button cc-button-secondary"
                  onClick={() => {
                    setAuthMode("signup");
                    setView("settings");
                  }}
                >
                  Create account
                </button>
              </section>
            )}
          </div>
        )}
        {!accountOnly && view === "providers" && (
          <div className="cc-page">
            <section className="cc-section-head">
              <div>
                <h2>Add an account</h2>
                <p className="cc-lead">
                  Choose a service below. Each account keeps its own connection.
                </p>
              </div>
            </section>
            {cloudSession.authenticated && (
              <BitgetConnectionPanel mode="accounts" onStatus={onBitgetStatus} />
            )}
            {cloudSession.authenticated && <BtccAccountPanel mode="accounts" />}
            <div className="cc-provider-grid">
              {providers
                .filter((p) => p.kind === "exchange")
                .map(renderProvider)}
            </div>
            <p className="cc-footnote">
              Provider access is shown only when verified. Bitget figures come
              from the official API with a read-only key. BTCC native copy
              operations are not connected. Nothing here can trade, transfer or
              withdraw.
            </p>
            <details className="cc-disclosure">
              <summary>
                Optional wallets <span>Phantom · MetaMask · Base</span>
              </summary>
              <p>
                Verify a public address through your wallet app. No transaction
                is requested.
              </p>
              <div className="cc-provider-grid">
                {providers
                  .filter((p) => ["phantom", "metamask", "base"].includes(p.id))
                  .map(renderProvider)}
              </div>
            </details>
          </div>
        )}
        {!accountOnly && view === "performance" && (
          <div className="cc-page">
            <AccountEvidencePanel />
            <PerformancePanel />
            <MarketOverview />
          </div>
        )}
        {!accountOnly && view === "portfolio" && (
          <div className="cc-page">
            <section className="cc-section-head">
              <div>
                <h2>Your positions</h2>
                <p className="cc-lead">
                  Exchange positions are displayed only after a verified account
                  connection. Existing local position records remain available.
                </p>
              </div>
            </section>
            {cloudSession.authenticated && (
              <BitgetConnectionPanel mode="positions" onStatus={onBitgetStatus} />
            )}
            {cloudSession.authenticated && <BtccAccountPanel mode="positions" />}
            <AccountEvidencePanel />
            <section className="cc-position-card">
              <span className="cc-position-icon">
                <WorkspaceIcon name="portfolio" />
              </span>
              <div>
                <span className="cc-pill cc-pill-muted">
                  Local records · not exchange data
                </span>
                <h2>Positions and approvals</h2>
                <p>
                  View existing locally recorded positions and owner approvals.
                  These are separate from exchange-confirmed positions.
                </p>
                <a className="cc-button" href="/copy-center/positions">
                  Open positions &amp; approvals{" "}
                  <span aria-hidden="true">→</span>
                </a>
                <small>
                  Local position records are not live exchange orders.
                </small>
              </div>
            </section>
            <section className="cc-notice">
              <span className="cc-notice-icon">i</span>
              <div>
                <strong>Live portfolio</strong>
                <p>
                  Live Bitget positions appear above once a read-only connection
                  is saved; refresh them on demand. Saved balance observations are
                  shown separately. A read-only connection cannot trade.
                </p>
                <button
                  className="cc-text-button"
                  onClick={() => setView("providers")}
                >
                  Review accounts →
                </button>
              </div>
            </section>
          </div>
        )}

        {!accountOnly && view === "risk" && (
          <div className="cc-page">
            <section className="cc-section-head">
              <div>
                <p className="cc-eyebrow">RISK FIRST</p>
                <h2>Risk limits</h2>
                <p className="cc-lead">
                  Set workspace limits and inspect risk exposure. Exchange-side
                  enforcement requires a verified supported connection.
                </p>
              </div>
              <span className="cc-pill cc-pill-safe">Planning only</span>
            </section>
            <div className="cc-risk-layout">
              <section className="cc-settings-card">
                <h3>Allocation plan</h3>
                <p>
                  Choose a small amount to plan for each independent provider.
                </p>
                <label className="cc-field">
                  Planned amount per provider <span>USD</span>
                  <input
                    type="number"
                    min="0"
                    max="100000"
                    step="1"
                    value={budget}
                    onChange={(e) => setBudget(e.target.value)}
                  />
                </label>
                <label className="cc-field">
                  Maximum planned loss <span>%</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    value={maxLoss}
                    onChange={(e) => setMaxLoss(e.target.value)}
                  />
                </label>
                <div className="cc-form-note">
                  Changes save to this browser automatically. They are not sent
                  to any exchange.
                </div>
              </section>
              <section className="cc-risk-summary">
                <p className="cc-eyebrow">ILLUSTRATIVE LIMIT</p>
                <span>Potential loss allowance per provider</span>
                <strong>{money(perProviderRisk)}</strong>
                <div className="cc-risk-bar">
                  <span style={{ width: Math.min(100, lossValue) + "%" }} />
                </div>
                <p>
                  Based on {money(budgetValue)} planned allocation and a{" "}
                  {lossValue}% loss threshold. Fees, slippage, leverage,
                  liquidity, and market gaps can cause losses beyond this
                  estimate.
                </p>
                <div className="cc-risk-check">
                  <span>✓</span> Separate provider allocations
                </div>
                <div className="cc-risk-check">
                  <span>✓</span> No automatic order execution in this workspace
                </div>
              </section>
            </div>
            <section className="cc-notice">
              <span className="cc-notice-icon">!</span>
              <div>
                <strong>Risk warning</strong>
                <p>
                  Copy trading can lose the entire allocated amount. Small
                  allocations do not remove market, custody, platform, or
                  counterparty risk.
                </p>
              </div>
            </section>
          </div>
        )}

        {!accountOnly && view === "activity" && (
          <div className="cc-page">
            <section className="cc-section-head">
              <div>
                <p className="cc-eyebrow">WORKSPACE HISTORY</p>
                <h2>Recent activity</h2>
                <p className="cc-lead">
                  Records created by this interface on this browser.
                </p>
              </div>
              <span className="cc-pill cc-pill-muted">
                {activity.length} records
              </span>
            </section>
            {activity.length ? (
              <div className="cc-activity-list">
                {activity.map((item) => (
                  <article key={item.id}>
                    <span className="cc-activity-dot" />
                    <div>
                      <strong>{item.title}</strong>
                      <p>{item.detail}</p>
                      <time>{new Date(item.at).toLocaleString()}</time>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="cc-portfolio-empty">
                <div className="cc-empty-icon">≡</div>
                <h3>No activity recorded yet</h3>
                <p>
                  Account verification and workspace actions appear here. This
                  history does not substitute for exchange trade records.
                </p>
                <button
                  className="cc-button"
                  onClick={() => setView("providers")}
                >
                  Review a provider
                </button>
              </div>
            )}
          </div>
        )}

        {view === "settings" && (
          <div className="cc-page">
            {!accountOnly && (
              <section className="cc-section-head">
                <div>
                  <p className="cc-eyebrow">WORKSPACE SETTINGS</p>
                  <h2>Your account &amp; preferences</h2>
                  <p className="cc-lead">
                    Manage your sign-in and sync only the planning data you
                    choose.
                  </p>
                </div>
              </section>
            )}
            <section className="cc-settings-card cc-cloud-card">
              <span className="cc-setting-icon">☁</span>
              <h3>Your GEM account</h3>
              <p>
                {cloudSession.authenticated
                  ? "Signed in as " +
                    (cloudSession.user?.email || "your account") +
                    "."
                  : cloudSession.configured
                    ? "Sign in or create an account to save planning preferences across devices."
                    : "Cloud account service is not configured. Local planning still works."}
              </p>
              {!cloudSession.authenticated && (
                <form
                  className="cc-cloud-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void cloudAuth(authMode === "signup" ? "signup" : "login");
                  }}
                >
                  <label className="cc-field">
                    Email
                    <input
                      type="email"
                      autoComplete="email"
                      value={cloudEmail}
                      onChange={(e) => setCloudEmail(e.target.value)}
                      required
                      maxLength={254}
                    />
                  </label>
                  <label className="cc-field">
                    Password
                    <input
                      type="password"
                      autoComplete={
                        authMode === "signup"
                          ? "new-password"
                          : "current-password"
                      }
                      value={cloudPassword}
                      onChange={(e) => setCloudPassword(e.target.value)}
                      required
                      minLength={authMode === "signup" ? 12 : 1}
                      maxLength={256}
                    />
                  </label>
                  {authMode === "signup" && (
                    <p className="cc-form-note">
                      Use at least 12 characters. If email confirmation is
                      enabled, sign-in will wait until you confirm.
                    </p>
                  )}
                  <div className="cc-modal-actions">
                    <button
                      className="cc-button"
                      disabled={cloudBusy || !cloudSession.configured}
                    >
                      {cloudBusy
                        ? "Working…"
                        : authMode === "signup"
                          ? "Create account"
                          : "Sign in"}
                    </button>
                    <button
                      type="button"
                      className="cc-button cc-button-secondary"
                      disabled={cloudBusy}
                      onClick={() =>
                        setAuthMode(authMode === "signup" ? "signin" : "signup")
                      }
                    >
                      {authMode === "signup"
                        ? "I have an account"
                        : "Create account"}
                    </button>
                  </div>
                  <a href="/forgot-password" className="secondary-btn">Forgot password?</a>
                  <button
                    type="button"
                    className="cc-text-button"
                    disabled={cloudBusy || !cloudEmail}
                    onClick={() => void cloudAuth("resend")}
                  >
                    Resend confirmation email
                  </button>
                </form>
              )}
              {cloudSession.authenticated && (
                <div className="cc-cloud-actions">
                  {!accountOnly && (
                    <>
                      <button
                        className="cc-button"
                        disabled={cloudBusy}
                        onClick={() => void syncCloud("save")}
                      >
                        {cloudBusy ? "Working…" : "Save to cloud"}
                      </button>
                      <button
                        className="cc-button cc-button-secondary"
                        disabled={cloudBusy}
                        onClick={() => void syncCloud("restore")}
                      >
                        Restore cloud data
                      </button>
                    </>
                  )}
                  <button
                    className="cc-text-button"
                    disabled={cloudBusy}
                    onClick={() => void cloudAuth("logout")}
                  >
                    Sign out
                  </button>
                </div>
              )}
              {cloudUpdatedAt && (
                <p className="cc-form-note">
                  Last cloud sync: {new Date(cloudUpdatedAt).toLocaleString()}
                </p>
              )}
              {cloudMessage && (
                <p className="cc-form-note" role="status">
                  {cloudMessage}
                </p>
              )}
              <span
                className={
                  "cc-pill " +
                  (cloudSession.authenticated ? "cc-pill-safe" : "cc-pill-off")
                }
              >
                {cloudSession.authenticated
                  ? "Authenticated"
                  : cloudSession.configured
                    ? "Signed out"
                    : "Setup required"}
              </span>
              <p className="cc-form-note">
                Only planning preferences and activity are synced by this panel.
                API secrets, seed phrases, private keys, and wallet sessions are
                never uploaded.
              </p>
            </section>
            {!accountOnly && (
              <>
                <div className="cc-settings-grid">
                  <article className="cc-settings-card">
                    <h3>Workspace activity</h3>
                    <p>
                      Review your recent setup and planning history on this
                      browser.
                    </p>
                    <button
                      className="cc-card-button"
                      onClick={() => setView("activity")}
                    >
                      View activity →
                    </button>
                  </article>
                  <article className="cc-settings-card">
                    <h3>Local workspace</h3>
                    <p>
                      Reset planning amounts and local history. Cloud data is
                      not deleted.
                    </p>
                    <button
                      className="cc-card-button"
                      onClick={() => {
                        if (
                          window.confirm(
                            "Reset this browser's GEM Copy Center planning data? This cannot be undone.",
                          )
                        ) {
                          setProviders(starterProviders);
                          setActivity([]);
                          setBudget("10");
                          setMaxLoss("2");
                          setToast("Local planning workspace reset.");
                        }
                      }}
                    >
                      Reset local data
                    </button>
                  </article>
                </div>
                <details className="cc-disclosure">
                  <summary>
                    Advanced tools{" "}
                    <span>Research &amp; technical controls</span>
                  </summary>
                  <div className="cc-settings-grid">
                    <article className="cc-settings-card">
                      <h3>Research engine</h3>
                      <p>
                        Detailed trader profiles, allocation proposals, and risk
                        reports.
                      </p>
                      <a className="cc-card-button" href="/copy-trading">
                        Open research →
                      </a>
                      <a className="cc-card-button" href="/opportunities">
                        Opportunity monitor →
                      </a>
                    </article>
                    <article className="cc-settings-card">
                      <h3>BTCC control room</h3>
                      <p>
                        Existing technical controls remain separate. Live
                        financial actions require your explicit authorization.
                      </p>
                      <a className="cc-card-button" href="/steel">
                        Open BTCC browser controls →
                      </a>
                    </article>
                    <article className="cc-settings-card">
                      <h3>Other services</h3>
                      <p>
                        Farcaster and MetaTrader 5 adapters are not implemented.
                      </p>
                      {providers
                        .filter((p) => ["farcaster", "mt5"].includes(p.id))
                        .map((p) => (
                          <button
                            key={p.id}
                            className="cc-card-button"
                            onClick={() => requestConnection(p)}
                          >
                            View {p.name} status →
                          </button>
                        ))}
                    </article>
                  </div>
                </details>
              </>
            )}
          </div>
        )}
      </main>

      {selected && (
        <div
          className="cc-modal-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSelected(null);
          }}
        >
          <section
            ref={modalRef}
            className="cc-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cc-modal-title"
          >
            <button
              className="cc-modal-close"
              onClick={() => setSelected(null)}
              aria-label="Close setup"
            >
              ×
            </button>
            <p className="cc-eyebrow">CONNECTION SETUP</p>
            <span className={"cc-provider-icon cc-icon-" + selected.kind}>
              {selected.name.slice(0, 1)}
            </span>
            <h2 id="cc-modal-title">Set up {selected.name}</h2>
            <span
              className={
                "cc-pill " +
                (selected.state !== "not-connected"
                  ? "cc-pill-safe"
                  : "cc-pill-off")
              }
            >
              {selected.state === "connected"
                ? "Verified session"
                : selected.state === "verified-once"
                  ? "Verified once"
                  : "Not connected"}
            </span>
            <p>{selected.note}</p>
            {selected.id === "bitget" && !cloudSession.authenticated && (
              <div className="cc-notice">
                <div>
                  <strong>Sign in first</strong>
                  <p>Your GEM account is required for a read-only check.</p>
                  <button
                    className="cc-button"
                    onClick={() => {
                      setSelected(null);
                      setView("settings");
                    }}
                  >
                    Sign in / Create account
                  </button>
                </div>
              </div>
            )}
            {selected.id === "bitget" && cloudSession.authenticated && (
              <form
                className="cc-credential-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveBitget();
                }}
              >
                <p className="cc-form-note">
                  Use a Bitget API key whose overall permission type is
                  read-only and whose permission is UTA management. Keys with
                  trading, copy-trading or withdrawal permissions are rejected.
                  Saving encrypts the key on the GEM server (never in this
                  browser) so balances can be refreshed on demand. Choose
                  &ldquo;Verify once&rdquo; to check without saving.
                </p>
                <label className="cc-field">
                  API key
                  <input
                    type="password"
                    autoComplete="off"
                    value={bgKey}
                    onChange={(e) => setBgKey(e.target.value)}
                    maxLength={256}
                    required
                  />
                </label>
                <label className="cc-field">
                  API secret
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={bgSecret}
                    onChange={(e) => setBgSecret(e.target.value)}
                    maxLength={256}
                    required
                  />
                </label>
                <label className="cc-field">
                  API passphrase
                  <input
                    type="password"
                    autoComplete="off"
                    value={bgPhrase}
                    onChange={(e) => setBgPhrase(e.target.value)}
                    maxLength={256}
                    required
                  />
                </label>
                <div className="cc-modal-actions">
                  <button
                    className="cc-button"
                    disabled={bgBusy || !cloudSession.authenticated}
                  >
                    {bgBusy ? "Verifying…" : "Save read-only connection"}
                  </button>
                  <button
                    type="button"
                    className="cc-button cc-button-secondary"
                    disabled={bgBusy || !cloudSession.authenticated}
                    onClick={() => void verifyBitget()}
                  >
                    Verify once without saving
                  </button>
                </div>
                {bgMessage && (
                  <p className="cc-form-note" role="status">
                    {bgMessage}
                  </p>
                )}
                {bgResult && (
                  <div className="cc-notice" role="status">
                    <span className="cc-notice-icon">✓</span>
                    <div>
                      <strong>Read-only verification passed</strong>
                      <p>
                        Verified{" "}
                        {new Date(bgResult.verifiedAt).toLocaleString()}.{" "}
                        {bgResult.accountEquityUsd !== null
                          ? "Account equity: " +
                            money(bgResult.accountEquityUsd) +
                            ". "
                          : ""}
                        {bgResult.usdtEquity !== null
                          ? "USDT equity: " + bgResult.usdtEquity + ". "
                          : ""}
                        {bgResult.btcEquity !== null
                          ? "BTC equity: " + bgResult.btcEquity + ". "
                          : ""}
                        This is a one-time response, not live streaming or a
                        stored balance.
                      </p>
                    </div>
                  </div>
                )}
              </form>
            )}
            {selected.id === "btcc" && (
              <div className="cc-notice">
                <span className="cc-notice-icon">i</span>
                <div>
                  <strong>BTCC native connection</strong>
                  <p>
                    BTCC announced on February 13, 2026 that futures API trading
                    functions would be suspended and the API application portal
                    closed pending a restoration notice. GEM has not verified
                    that the futures API has been restored. Do not enter BTCC
                    API credentials here; manage copy activation directly in
                    BTCC's official Copy Trading screen. To see your BTCC
                    balances, positions and copy history here, import CSV
                    exports in Accounts. They are shown as owner-imported, not
                    live.
                  </p>
                  <a
                    href="https://www.btcc.com/en-US/copy-trading"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open official BTCC Copy Trading ↗
                  </a>
                  <br />
                  <a
                    href="https://www.btcc.com/en-US/detail/176811"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Read BTCC’s official API notice ↗
                  </a>
                  <br />
                  <a
                    href="https://www.btcc.com/en-US/user-center/setting/api"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open official BTCC API settings ↗
                  </a>
                </div>
              </div>
            )}
            {(selected.id === "phantom" ||
              selected.id === "metamask" ||
              selected.id === "base") && (
              <div className="cc-form-note">
                <p>
                  This connection reads the public wallet address only. GEM does
                  not request a message signature, token approval, transaction,
                  or withdrawal.
                </p>
                <p>
                  <strong>iPhone tip:</strong> Open this site inside the wallet
                  app’s built-in browser, then return here and tap Connect
                  wallet. iOS Safari and the ChatGPT in-app browser may not
                  expose the wallet provider.
                </p>
                <p>
                  <a
                    href="https://help.phantom.com/articles/how-to-connect-phantom-to-a-dapp-29995498642195"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Phantom’s iPhone connection guide ↗
                  </a>{" "}
                  ·{" "}
                  <a
                    href="https://docs.metamask.io/metamask-connect/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    MetaMask mobile connection docs ↗
                  </a>
                </p>
              </div>
            )}
            <details className="cc-disclosure">
              <summary>Connection checklist</summary>
              <ol>
                <li>Open the official service and confirm you can sign in.</li>
                <li>Start with read-only permissions wherever supported.</li>
                <li>
                  Never share passwords, seed phrases, private keys, or API
                  secrets in chat.
                </li>
                <li>
                  Verify the integration and its status before relying on
                  displayed balances.
                </li>
              </ol>
            </details>
            <div className="cc-modal-actions">
              <button
                className="cc-button cc-button-secondary"
                onClick={() => setSelected(null)}
              >
                Close
              </button>
              {selected.id === "phantom" ||
              selected.id === "metamask" ||
              selected.id === "base" ? (
                <button
                  className="cc-button"
                  onClick={() => void connectWallet(selected)}
                >
                  Connect wallet
                </button>
              ) : (
                <button
                  className="cc-button"
                  onClick={() => confirmNotConnected(selected)}
                >
                  Record review
                </button>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
