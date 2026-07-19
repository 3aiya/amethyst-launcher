import fs from "node:fs";
import type { SkinVariant } from "../../shared/ipc-types";

const SKIN_URL = "https://api.minecraftservices.com/minecraft/profile/skins";

export async function setSkinFromFile(
  accessToken: string,
  filePath: string,
  variant: SkinVariant
): Promise<void> {
  const buffer = fs.readFileSync(filePath);
  const form = new FormData();
  form.append("variant", variant);
  form.append("file", new Blob([buffer], { type: "image/png" }), "skin.png");

  const response = await fetch(SKIN_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });

  if (!response.ok) {
    throw new Error(`Skin upload failed: ${response.status} ${await response.text()}`);
  }
}

export async function resetSkin(accessToken: string): Promise<void> {
  const response = await fetch(`${SKIN_URL}/active`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`Skin reset failed: ${response.status} ${await response.text()}`);
  }
}
