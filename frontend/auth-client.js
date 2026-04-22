(function () {
  const STORAGE_KEY = "intent-auth-session";
  let authState = {
    token: "",
    user: null,
    enabled: false,
    needsBootstrap: false
  };

  function readStoredAuth() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      authState = {
        ...authState,
        token: parsed.token || "",
        user: parsed.user || null
      };
    } catch {
      authState = {
        ...authState,
        token: "",
        user: null
      };
    }
    return authState;
  }

  function writeStoredAuth() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      token: authState.token,
      user: authState.user
    }));
  }

  function clearAuth() {
    authState = {
      token: "",
      user: null,
      enabled: authState.enabled,
      needsBootstrap: authState.needsBootstrap
    };
    writeStoredAuth();
  }

  async function api(path, options = {}) {
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {})
    };
    if (authState.token) {
      headers.Authorization = `Bearer ${authState.token}`;
    }

    const response = await fetch(path, {
      ...options,
      headers
    });

    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json")
      ? await response.json().catch(() => ({}))
      : await response.text();

    if (!response.ok) {
      const message = typeof payload === "string" ? payload : payload.error || `Request failed with ${response.status}`;
      if (response.status === 401) {
        clearAuth();
      }
      throw new Error(message);
    }

    return payload;
  }

  async function fetchAuthState() {
    readStoredAuth();
    const headers = authState.token ? { Authorization: `Bearer ${authState.token}` } : {};
    const response = await fetch("/api/v1/auth/state", { headers });
    const payload = await response.json().catch(() => ({}));
    authState = {
      ...authState,
      enabled: Boolean(payload.enabled),
      needsBootstrap: Boolean(payload.needsBootstrap),
      user: payload.user || null
    };
    if (!authState.user && response.status === 401) {
      clearAuth();
    } else {
      writeStoredAuth();
    }
    return payload;
  }

  function saveAuth({ token, user }) {
    authState = {
      ...authState,
      token: token || "",
      user: user || null
    };
    writeStoredAuth();
  }

  async function logout(next = "./login.html") {
    try {
      if (authState.token) {
        await api("/api/v1/auth/logout", {
          method: "POST",
          body: JSON.stringify({})
        });
      }
    } catch {
    }
    clearAuth();
    window.location.href = next;
  }

  function attachNavUser() {
    const nav = document.querySelector(".top-nav");
    if (!nav) {
      return;
    }

    const existing = nav.querySelector(".auth-nav");
    if (existing) {
      existing.remove();
    }

    if (!authState.enabled || !authState.user) {
      return;
    }

    const shell = document.createElement("div");
    shell.className = "auth-nav";

    const badge = document.createElement("span");
    badge.className = "user-badge";
    badge.textContent = `${authState.user.name} · ${authState.user.role}`;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "ghost-button mini";
    button.textContent = "Logout";
    button.addEventListener("click", () => logout("./login.html"));

    shell.append(badge, button);
    nav.appendChild(shell);
  }

  async function requirePageAuth() {
    const payload = await fetchAuthState();
    attachNavUser();

    if (payload.enabled && !payload.user) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `./login.html?next=${next}`;
      throw new Error(payload.needsBootstrap ? "Bootstrap an admin account first." : "Authentication required.");
    }

    return payload;
  }

  readStoredAuth();

  window.intentAuth = {
    api,
    saveAuth,
    clearAuth,
    fetchAuthState,
    requirePageAuth,
    logout,
    get token() {
      return authState.token;
    },
    get user() {
      return authState.user;
    }
  };
})();
