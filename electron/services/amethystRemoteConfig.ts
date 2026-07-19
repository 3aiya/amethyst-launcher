/**
 * Amethyst modpack hosting configuration.
 *
 * Versions are just zip files sitting in a shared Google Drive folder - one
 * zip per version, named after the Minecraft version it targets (e.g.
 * "1.20.6.zip", "1.21.11.zip"). Each zip should contain, at its root:
 *
 *   mods/           - the pack's mod jars
 *   config/         - the pack's mod configs
 *   servers.dat     - the server list to install alongside it
 *
 * To go live:
 * 1. Create (or reuse) a Google Cloud project, enable the "Google Drive API",
 *    and create an API key (APIs & Services -> Credentials -> Create
 *    Credentials -> API key). Paste it into GOOGLE_DRIVE_API_KEY below.
 * 2. Share your Drive folder as "Anyone with the link -> Viewer".
 * 3. Copy the folder ID out of its URL
 *    (https://drive.google.com/drive/folders/<THIS_PART>) into
 *    GOOGLE_DRIVE_FOLDER_ID below.
 *
 * From then on, dropping a new "<version>.zip" into that folder is all it
 * takes for the launcher to pick it up - nothing else in the codebase needs
 * to change, and no local folder is used anymore.
 */

export const GOOGLE_DRIVE_FOLDER_ID = "1TsirakO8CHclRtu84j9WJgXeXo2sQRkP";
export const GOOGLE_DRIVE_API_KEY = "AIzaSyA7WZmU5GOaRWsZ3SKr7ZAndlqjwHTD2Q8";
