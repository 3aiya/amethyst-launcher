/**
 * Terms of Service and Privacy Policy shown on first launch. Bump `LEGAL_VERSION` - together with `LEGAL_VERSION`
 * in `src-tauri/src/types.rs` - whenever either document changes in a way
 * users need to agree to again; everyone is then shown the consent screen on
 * their next launch.
 */
export const LEGAL_VERSION = 1;
export const LEGAL_UPDATED = "October 18, 2026";

export type LegalDocId = "terms" | "privacy";

export interface LegalSection {
  heading: string;
  /** Paragraphs; a paragraph starting with "- " is shown as a bullet. */
  body: string[];
}

export interface LegalDoc {
  id: LegalDocId;
  title: string;
  summary: string;
  sections: LegalSection[];
}

export const TERMS: LegalDoc = {
  id: "terms",
  title: "Terms of Service",
  summary:
    "The rules for using Amethyst Launcher. In short: play fair, own your copy of Minecraft, and use the launcher at your own risk.",
  sections: [
    {
      heading: "1. Accepting these terms",
      body: [
        "By installing or using Amethyst Launcher (\"the launcher\") you agree to these Terms of Service and to our Privacy Policy. If you do not agree, do not use the launcher - choosing Decline closes it, and nothing is set up until you accept.",
      ],
    },
    {
      heading: "2. Not affiliated with Mojang or Microsoft",
      body: [
        "Amethyst Launcher is an independent, community-made project. It is not an official Minecraft product and is not approved by or associated with Mojang AB or Microsoft. \"Minecraft\" is a trademark of Mojang AB.",
        "Minecraft itself is governed by the Minecraft End User License Agreement (EULA) and the Microsoft Services Agreement. By launching the game through Amethyst you also agree to follow them.",
      ],
    },
    {
      heading: "3. Your accounts",
      body: [
        "Signing in with Microsoft happens directly with Microsoft - the launcher never sees your password. You are responsible for keeping your computer and your accounts secure.",
        "Offline mode is meant for playing single-player and on servers that allow it. It is not a way to get Minecraft without buying it; please own a legitimate copy of the game.",
      ],
    },
    {
      heading: "4. Mods, modpacks and third-party content",
      body: [
        "The Browse tab lets you download mods, resource packs, shaders and modpacks from Modrinth and CurseForge. That content is made by third parties, belongs to its authors and comes with its own licenses. We do not review it and are not responsible for what it does.",
        "Only install content you trust, and respect each creator's license and terms.",
      ],
    },
    {
      heading: "5. Fair use",
      body: [
        "- Do not use the launcher to cheat, harass other players, or break the rules of any server you join.",
        "- Do not attempt to disrupt, overload or abuse the Amethyst services (news, configuration and the community server).",
        "- Do not redistribute modified builds of the launcher under the Amethyst name in a way that could mislead people.",
        "Amethyst Community server staff may restrict access for anyone who breaks these rules or the server's own rules.",
      ],
    },
    {
      heading: "6. Updates",
      body: [
        "The launcher checks GitHub for new versions and can update itself. Updates are signed; you can always choose when to restart into a new version.",
      ],
    },
    {
      heading: "7. Open source and no warranty",
      body: [
        "Amethyst Launcher is open-source software released under the MIT License. It is provided \"as is\", without warranty of any kind. To the fullest extent allowed by law, the authors are not liable for any loss of data, worlds, accounts or other damages arising from its use. Back up the worlds you care about.",
      ],
    },
    {
      heading: "8. Changes to these terms",
      body: [
        "We may update these terms. When a change matters, the launcher will show this screen again and ask you to accept the new version before continuing.",
      ],
    },
    {
      heading: "9. Contact",
      body: [
        "Questions or concerns? Open an issue at github.com/3aiya/amethyst-launcher or reach out through the Amethyst Community.",
      ],
    },
  ],
};

export const PRIVACY: LegalDoc = {
  id: "privacy",
  title: "Privacy Policy",
  summary:
    "What the launcher sends, where, and why. Your accounts, worlds and files stay on your PC - we never sell or share your data.",
  sections: [
    {
      heading: "1. What stays on your computer",
      body: [
        "Your Minecraft account tokens, launcher account, settings, skins, instances, worlds and game files are stored only on your own computer, under your user profile. None of it is uploaded anywhere.",
      ],
    },
    {
      heading: "2. Who the launcher talks to",
      body: [
        "To do its job the launcher connects to the following services, and transfers nothing beyond what is listed:",
        "- Microsoft, Xbox Live and Mojang - your Microsoft sign-in and the tokens it returns, only when you choose Microsoft sign-in.",
        "- Mojang download servers - which Minecraft version you are installing.",
        "- Fabric and Forge - which loader version you are installing.",
        "- Modrinth and CurseForge - your search terms and the content you install, only while you use Browse.",
        "- textures.minecraft.net and crafatar.com - the account UUID whose skin is being shown.",
        "- Minecraft servers you add - a standard server status ping for the server list.",
        "- GitHub - your launcher version, to check for and download updates.",
        "- The Amethyst admin service - news and configuration requests, plus the anonymous usage ping described below.",
      ],
    },
    {
      heading: "3. Anonymous usage ping",
      body: [
        "When the launcher opens and when a game starts, it sends a small anonymous ping: a random install id generated on your PC, the launcher version, your operating system and - for a game launch - the Minecraft version and loader.",
        "It never contains your account name, UUID, email address, IP-derived location, file paths or anything else that identifies you, and the install id is never linked to an account. We use it only for rough install and launch counts.",
        "Nothing is sent before you accept this policy.",
      ],
    },
    {
      heading: "4. Discord Rich Presence",
      body: [
        "Rich Presence talks to the Discord app on your own machine over local IPC; the launcher makes no network request for it. Turn it off under Settings -> Discord Rich Presence.",
      ],
    },
    {
      heading: "5. What we never do",
      body: [
        "- We do not sell, rent or share your data with advertisers.",
        "- We do not bundle ads, offers or any other unwanted software.",
        "- We do not scan your computer or collect files from it.",
      ],
    },
    {
      heading: "6. Third-party services",
      body: [
        "The services listed above have their own privacy policies, which apply when the launcher talks to them on your behalf.",
      ],
    },
    {
      heading: "7. Your choices",
      body: [
        "You can sign out and remove saved accounts from the account switcher, turn off Rich Presence in Settings, and uninstall the launcher to remove its data from your PC.",
      ],
    },
    {
      heading: "8. Changes to this policy",
      body: [
        "If this policy changes in a way that matters, the launcher will ask you to review and accept it again. The latest version is always available at launcher.amethystcommunity.net/privacy.",
      ],
    },
  ],
};

export const LEGAL_DOCS: Record<LegalDocId, LegalDoc> = { terms: TERMS, privacy: PRIVACY };
