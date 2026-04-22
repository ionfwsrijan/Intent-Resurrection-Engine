const elements = {
  authTitle: document.querySelector("#authTitle"),
  authLead: document.querySelector("#authLead"),
  authStatus: document.querySelector("#authStatus"),
  authForm: document.querySelector("#authForm"),
  authSubmitButton: document.querySelector("#authSubmitButton"),
  nameField: document.querySelector("#nameField"),
  authName: document.querySelector("#authName"),
  authEmail: document.querySelector("#authEmail"),
  authPassword: document.querySelector("#authPassword")
};

let bootstrapMode = false;

function setStatus(message, tone = "idle") {
  elements.authStatus.textContent = message;
  elements.authStatus.className = `status-banner ${tone}`;
}

function redirectTarget() {
  const next = new URLSearchParams(window.location.search).get("next");
  return next || "./index.html";
}

async function loadState() {
  const auth = await window.intentAuth.fetchAuthState();
  bootstrapMode = Boolean(auth.needsBootstrap);

  if (auth.enabled && auth.user) {
    window.location.href = redirectTarget();
    return;
  }

  if (bootstrapMode) {
    elements.authTitle.textContent = "Create the first admin account";
    elements.authLead.textContent = "This is a one-time bootstrap step. It will claim any unowned workspaces in the current local database.";
    elements.authSubmitButton.textContent = "Create admin account";
    elements.nameField.classList.remove("hidden-field");
    setStatus("Bootstrap mode is active.", "idle");
  } else {
    elements.authTitle.textContent = "Sign in to the dashboard";
    elements.authLead.textContent = "Use the admin or team account created for this local instance.";
    elements.authSubmitButton.textContent = "Sign in";
    elements.nameField.classList.add("hidden-field");
    setStatus("Ready for login.", "idle");
  }
}

elements.authForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = elements.authEmail.value.trim();
  const password = elements.authPassword.value;
  const name = elements.authName.value.trim();

  if (!email || !password) {
    setStatus("Email and password are required.", "error");
    return;
  }

  try {
    const endpoint = bootstrapMode ? "/api/v1/auth/bootstrap-admin" : "/api/v1/auth/login";
    const payload = await window.intentAuth.api(endpoint, {
      method: "POST",
      body: JSON.stringify(bootstrapMode ? { email, password, name } : { email, password })
    });
    window.intentAuth.saveAuth(payload);
    setStatus(bootstrapMode ? "Admin account created." : "Login successful.", "success");
    window.location.href = redirectTarget();
  } catch (error) {
    setStatus(error.message, "error");
  }
});

loadState().catch((error) => {
  setStatus(`Could not load auth state. ${error.message}`, "error");
});
