// Latest GitHub release, seeded at build time and refreshed in the browser so the install
// section always points at the newest .vsix.
import { writable } from "svelte/store";
import fallback from "../release.js";

const REPO = "rec1dite/denote";

export const latestRelease = writable(fallback);

export async function refreshLatestRelease() {
  try {
    const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) return;
    const data = await response.json();
    const tag = data.tag_name ?? fallback.tag;
    const version = tag.replace(/^v/, "");
    const asset = (data.assets ?? []).find((a) => a.name?.endsWith(".vsix"));
    latestRelease.set({
      tag,
      version,
      vsixUrl:
        asset?.browser_download_url ??
        `https://github.com/${REPO}/releases/download/${tag}/denote-${version}.vsix`,
      releaseUrl: data.html_url ?? fallback.releaseUrl,
    });
  } catch (err) {
    /* keep the build-time value */
  }
}

export function installCommands(release) {
  return [
    "# install the Deno Jupyter kernel once",
    "deno jupyter --install",
    "",
    "# download the latest .vsix from GitHub releases",
    `curl -L -o denote.vsix ${release.vsixUrl}`,
    "# or",
    `wget -O denote.vsix ${release.vsixUrl}`,
    "",
    "# install it",
    "code --install-extension denote.vsix",
  ].join("\n");
}
