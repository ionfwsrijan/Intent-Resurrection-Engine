const fields = {
  ingestionUrl: document.querySelector("#ingestionUrl"),
  sourceToken: document.querySelector("#sourceToken"),
  sessionLabel: document.querySelector("#sessionLabel"),
  userLabel: document.querySelector("#userLabel"),
  captureIntervalMinutes: document.querySelector("#captureIntervalMinutes"),
  autoSend: document.querySelector("#autoSend"),
  ignoreNoisyTabs: document.querySelector("#ignoreNoisyTabs"),
  redactUrls: document.querySelector("#redactUrls"),
  localOnlyMode: document.querySelector("#localOnlyMode"),
  includeTabTitles: document.querySelector("#includeTabTitles"),
  includeTabUrls: document.querySelector("#includeTabUrls"),
  includeClusters: document.querySelector("#includeClusters"),
  includeTimeline: document.querySelector("#includeTimeline"),
  allowedHosts: document.querySelector("#allowedHosts"),
  blockedHosts: document.querySelector("#blockedHosts")
};

const message = document.querySelector("#message");
const saveButton = document.querySelector("#saveButton");

function setMessage(value) {
  message.textContent = value;
}

function sendMessage(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, payload });
}

async function loadSettings() {
  const result = await sendMessage("get-settings");
  if (!result.ok) {
    setMessage(result.message || "Could not load settings.");
    return;
  }

  const settings = result.settings || {};
  fields.ingestionUrl.value = settings.ingestionUrl || "";
  fields.sourceToken.value = settings.sourceToken || "";
  fields.sessionLabel.value = settings.sessionLabel || "primary-browser";
  fields.userLabel.value = settings.userLabel || "";
  fields.captureIntervalMinutes.value = settings.captureIntervalMinutes || 5;
  fields.autoSend.checked = settings.autoSend ?? true;
  fields.ignoreNoisyTabs.checked = settings.ignoreNoisyTabs ?? true;
  fields.redactUrls.checked = Boolean(settings.redactUrls);
  fields.localOnlyMode.checked = Boolean(settings.localOnlyMode);
  fields.includeTabTitles.checked = settings.includeTabTitles ?? true;
  fields.includeTabUrls.checked = settings.includeTabUrls ?? true;
  fields.includeClusters.checked = settings.includeClusters ?? true;
  fields.includeTimeline.checked = settings.includeTimeline ?? true;
  fields.allowedHosts.value = settings.allowedHosts || "";
  fields.blockedHosts.value = settings.blockedHosts || "";
}

saveButton.addEventListener("click", async () => {
  const payload = {
    ingestionUrl: fields.ingestionUrl.value.trim(),
    sourceToken: fields.sourceToken.value.trim(),
    sessionLabel: fields.sessionLabel.value.trim() || "primary-browser",
    userLabel: fields.userLabel.value.trim(),
    autoSend: fields.autoSend.checked,
    captureIntervalMinutes: Number(fields.captureIntervalMinutes.value || 5),
    ignoreNoisyTabs: fields.ignoreNoisyTabs.checked,
    redactUrls: fields.redactUrls.checked,
    localOnlyMode: fields.localOnlyMode.checked,
    includeTabTitles: fields.includeTabTitles.checked,
    includeTabUrls: fields.includeTabUrls.checked,
    includeClusters: fields.includeClusters.checked,
    includeTimeline: fields.includeTimeline.checked,
    allowedHosts: fields.allowedHosts.value.trim(),
    blockedHosts: fields.blockedHosts.value.trim()
  };

  const result = await sendMessage("save-settings", payload);
  if (!result.ok) {
    setMessage(result.message || "Could not save settings.");
    return;
  }

  setMessage("Settings saved. The collector can now send live tab snapshots.");
});

loadSettings();
