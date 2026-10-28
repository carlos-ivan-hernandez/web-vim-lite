const storage = chrome.storage.local;
const siteRow = document.getElementById("site-row");
const site = document.getElementById("site");
const hostLabel = document.getElementById("host");
const noSite = document.getElementById("no-site");
const cmdEscape = document.getElementById("cmd-escape");
const shortcuts = document.getElementById("shortcuts");
const normalKey = document.getElementById("normal-key");

// The shortcuts list stays open or closed as it was last left.
try {
  shortcuts.open = localStorage.getItem("shortcutsOpen") === "1";
} catch {}
shortcuts.addEventListener("toggle", () => {
  try {
    localStorage.setItem("shortcutsOpen", shortcuts.open ? "1" : "0");
  } catch {}
});

function showNormalKey() {
  normalKey.innerHTML = cmdEscape.checked ? "<kbd>⌘</kbd><kbd>Esc</kbd>" : "<kbd>Esc</kbd>";
}

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
  showNormalKey();

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
  cmdEscape.addEventListener("change", () => {
    showNormalKey();
    storage.set({ cmdEscape: cmdEscape.checked });
  });
}

main();
