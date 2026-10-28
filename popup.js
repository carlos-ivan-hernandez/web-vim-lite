const storage = chrome.storage.local;
const siteRow = document.getElementById("site-row");
const site = document.getElementById("site");
const hostLabel = document.getElementById("host");
const noSite = document.getElementById("no-site");
const cmdEscape = document.getElementById("cmd-escape");

// Asks the content script in the active tab which site it's on. Pages it doesn't run on
// (such as the browser's own pages) don't answer.
async function currentHost() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const reply = await chrome.tabs.sendMessage(tab.id, { type: "vimlite:host" });
    return (reply && reply.host) || null;
  } catch {
    return null;
  }
}

async function main() {
  const [host, settings] = await Promise.all([currentHost(), storage.get(["disabledHosts", "cmdEscape"])]);
  const disabledHosts = settings.disabledHosts || [];
  cmdEscape.checked = Boolean(settings.cmdEscape);

  if (host) {
    hostLabel.textContent = host;
    site.checked = !disabledHosts.includes(host);
  } else {
    siteRow.hidden = true;
    noSite.hidden = false;
  }

  site.addEventListener("change", async () => {
    const { disabledHosts = [] } = await storage.get("disabledHosts");
    const others = disabledHosts.filter((h) => h !== host);
    await storage.set({ disabledHosts: site.checked ? others : [...others, host] });
  });
  cmdEscape.addEventListener("change", () => storage.set({ cmdEscape: cmdEscape.checked }));
}

main();
