import crypto from "node:crypto";
import { Auth } from "msmc";
import type { Account } from "../../shared/ipc-types";

export function offlineLogin(username: string): Account {
  const trimmed = username.trim();
  if (!trimmed) throw new Error("Username cannot be empty.");
  if (trimmed.length > 25) throw new Error("Username is too long.");

  const uuid = crypto.createHash("md5").update(`OfflinePlayer:${trimmed}`).digest("hex");
  return {
    name: trimmed,
    uuid,
    accessToken: "0",
    authMode: "offline",
  };
}

/**
 * Opens msmc's built-in Electron popup for Microsoft login. Uses Mojang's own
 * public client ID internally, so there's no Azure app to register.
 */
export async function loginWithMicrosoft(): Promise<Account> {
  const authManager = new Auth("select_account");
  const xbox = await authManager.launch("electron", { width: 520, height: 720, resizable: false });
  const minecraft = await xbox.getMinecraft();

  if (!minecraft.profile?.id) {
    throw new Error("This Microsoft account does not own Minecraft.");
  }

  return {
    name: minecraft.profile.name,
    uuid: minecraft.profile.id,
    accessToken: minecraft.mcToken,
    refreshToken: minecraft.refreshTkn,
    authMode: "microsoft",
  };
}

export async function refreshMicrosoftLogin(refreshToken: string): Promise<Account> {
  const authManager = new Auth("select_account");
  const xbox = await authManager.refresh(refreshToken);
  const minecraft = await xbox.getMinecraft();

  if (!minecraft.profile?.id) {
    throw new Error("This Microsoft account does not own Minecraft.");
  }

  return {
    name: minecraft.profile.name,
    uuid: minecraft.profile.id,
    accessToken: minecraft.mcToken,
    refreshToken: minecraft.refreshTkn,
    authMode: "microsoft",
  };
}

export function toMclcUser(account: Account) {
  return {
    access_token: account.accessToken,
    client_token: account.uuid,
    uuid: account.uuid,
    name: account.name,
    user_properties: {},
    meta: { type: account.authMode === "offline" ? ("mojang" as const) : ("msa" as const) },
  };
}
