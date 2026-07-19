/**
 * Discord Rich Presence configuration.
 *
 * To go live:
 * 1. Create an application at https://discord.com/developers/applications
 *    and paste its "Application ID" into DISCORD_CLIENT_ID below.
 * 2. Under that application's Rich Presence -> Art Assets page, upload your
 *    image.png and give it an asset key (e.g. "amethyst_logo"). Paste that
 *    same key into DISCORD_LARGE_IMAGE_KEY below.
 *
 * That's it - nothing else in the codebase needs to change.
 */

export const DISCORD_CLIENT_ID = "1525477067284676628";

/** Asset key uploaded under the application's Rich Presence Art Assets. */
export const DISCORD_LARGE_IMAGE_KEY = "amethyst_logo_placeholder";
export const DISCORD_LARGE_IMAGE_TEXT = "Amethyst Launcher";
