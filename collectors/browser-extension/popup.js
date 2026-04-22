const statusNode = document.querySelector("#status");
const captureButton = document.querySelector("#captureButton");
const previewButton = document.querySelector("#previewButton");
const optionsButton = document.querySelector("#optionsButton");

function setStatus(message) {
  statusNode.textContent = message;
}

function sendMessage(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, payload });
}

async function loadStatus() {
  const result = await sendMessage("get-last-status");
  if (!result.ok) {
    setStatus(result.message || "Could not load status.");
    return;
  }

  const status = result.status || {};
  if (!status.lastCaptureAt) {
    setStatus("No captures have been sent yet.");
    return;
  }

  setStatus(`${status.lastCaptureStatus || "unknown"} · ${status.lastCaptureSummary || "No summary"} · ${new Date(status.lastCaptureAt).toLocaleString()}`);
}

captureButton.addEventListener("click", async () => {
  setStatus("Sending live tab capture...");
  const result = await sendMessage("send-capture");
  if (!result.ok) {
    setStatus(result.message || "Capture failed.");
    return;
  }
  setStatus("Capture sent successfully.");
  await loadStatus();
});

previewButton.addEventListener("click", async () => {
  setStatus("Building preview...");
  const result = await sendMessage("capture-preview");
  if (!result.ok) {
    setStatus(result.message || "Could not build preview.");
    return;
  }

  const tabCount = result.payload?.traces?.browserTabs?.length || 0;
  const clusterCount = result.payload?.traces?.browserClusters?.length || 0;
  const timelineCount = result.payload?.traces?.activityTimeline?.length || 0;
  const noteSummary = result.payload?.traces?.draftNotes?.[0]?.text || "No domain summary available.";
  setStatus(`Preview ready · ${tabCount} raw tab${tabCount === 1 ? "" : "s"} · ${clusterCount} cluster${clusterCount === 1 ? "" : "s"} · ${timelineCount} timeline event${timelineCount === 1 ? "" : "s"} · ${noteSummary}`);
});

optionsButton.addEventListener("click", () => chrome.runtime.openOptionsPage());

loadStatus();
