const elements = {
  demoSessionQueue: document.querySelector("#demoSessionQueue"),
  previousSessionButton: document.querySelector("#previousSessionButton"),
  nextSessionButton: document.querySelector("#nextSessionButton"),
  demoSessionTitle: document.querySelector("#demoSessionTitle"),
  demoIntent: document.querySelector("#demoIntent"),
  demoConfidence: document.querySelector("#demoConfidence"),
  demoEvidence: document.querySelector("#demoEvidence"),
  demoNextSteps: document.querySelector("#demoNextSteps"),
  demoPrivacy: document.querySelector("#demoPrivacy"),
  demoTemporal: document.querySelector("#demoTemporal")
};

const state = {
  sessions: [],
  selectedIndex: 0
};

async function api(path) {
  return window.intentAuth.api(path);
}

function renderList(container, items, ordered = false) {
  container.replaceChildren();
  const values = items?.length ? items : [ordered ? "No next steps yet." : "No evidence yet."];
  values.forEach((item) => {
    const node = document.createElement("li");
    node.textContent = item;
    container.appendChild(node);
  });
}

function renderSessionQueue() {
  elements.demoSessionQueue.replaceChildren();
  state.sessions.forEach((session, index) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `session-button ${index === state.selectedIndex ? "active" : ""}`;
    const title = document.createElement("strong");
    title.textContent = `${session.pinned ? "★ " : ""}${session.title}`;
    const meta = document.createElement("small");
    meta.textContent = `${session.channel} · ${session.latestAnalysis?.predictedIntent?.label || "No prediction"}`;
    card.append(title, meta);
    card.addEventListener("click", () => {
      state.selectedIndex = index;
      renderSessionQueue();
      renderSelectedSession();
    });
    elements.demoSessionQueue.appendChild(card);
  });
}

function renderSelectedSession() {
  const session = state.sessions[state.selectedIndex];
  if (!session) {
    elements.demoSessionTitle.textContent = "No session selected";
    elements.demoIntent.textContent = "Waiting for session data";
    elements.demoConfidence.textContent = "Select a session to start demo mode.";
    renderList(elements.demoEvidence, []);
    renderList(elements.demoNextSteps, [], true);
    elements.demoPrivacy.textContent = "No session selected.";
    elements.demoTemporal.textContent = "No recent history available.";
    return;
  }

  const summary = session.latestAnalysis?.summary || {};
  elements.demoSessionTitle.textContent = session.title;
  elements.demoIntent.textContent = summary.predictedIntent?.label || session.latestAnalysis?.predictedIntent?.label || "No prediction";
  elements.demoConfidence.textContent = summary.predictedIntent
    ? `${Math.round((summary.predictedIntent.confidence || 0) * 100)}% confidence · ${summary.predictedIntent.recoveryFocus || "Recovery guidance available"}`
    : "No analysis available yet.";
  renderList(elements.demoEvidence, summary.evidence || []);
  renderList(elements.demoNextSteps, summary.suggestedNextSteps || [], true);
  elements.demoPrivacy.textContent = summary.privacySummary
    ? `${summary.privacySummary.status} · ${summary.privacySummary.redactionCount} redactions`
    : "No privacy summary available.";
  elements.demoTemporal.textContent = summary.temporalSummary?.summary || "No recent history available.";
}

async function loadDemoSessions() {
  const dashboard = await api("/api/v1/dashboard");
  const prioritized = [...(dashboard.recentSessions || [])]
    .sort((left, right) => Number(Boolean(right.pinned)) - Number(Boolean(left.pinned)));
  state.sessions = prioritized.slice(0, 8);
  state.selectedIndex = 0;
  renderSessionQueue();
  renderSelectedSession();
}

elements.previousSessionButton.addEventListener("click", () => {
  if (!state.sessions.length) {
    return;
  }
  state.selectedIndex = (state.selectedIndex - 1 + state.sessions.length) % state.sessions.length;
  renderSessionQueue();
  renderSelectedSession();
});

elements.nextSessionButton.addEventListener("click", () => {
  if (!state.sessions.length) {
    return;
  }
  state.selectedIndex = (state.selectedIndex + 1) % state.sessions.length;
  renderSessionQueue();
  renderSelectedSession();
});

window.intentAuth.requirePageAuth()
  .then(() => loadDemoSessions())
  .catch((error) => {
    elements.demoConfidence.textContent = error.message;
  });
