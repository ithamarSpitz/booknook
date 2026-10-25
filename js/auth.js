import { ROUTES } from "./contract.js?v=18f2175";
import { loadProfile, saveDisplayName } from "./data.js?v=18f2175";
import { validateDisplayName } from "./settings.js?v=18f2175";

/**
 * @param {{ email?: string, password?: string }} fields
 */
export function validateLoginForm(fields) {
  const errors = {};
  const email = String(fields.email ?? "").trim();
  const password = String(fields.password ?? "");

  if (!email) {
    errors.email = "נא להזין כתובת אימייל";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = "כתובת אימייל לא תקינה";
  }
  if (!password) {
    errors.password = "נא להזין סיסמה";
  }

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    email,
    password,
  };
}

/**
 * @param {unknown} error
 * @returns {string}
 */
export function mapLoginError(error) {
  if (!error) return "שגיאה בהתחברות";
  const err = /** @type {{ message?: string, code?: string, status?: number, name?: string }} */ (error);
  const message = String(err.message ?? "");
  const lower = message.toLowerCase();

  if (
    err.name === "AuthRetryableFetchError" ||
    err instanceof TypeError ||
    lower.includes("failed to fetch") ||
    lower.includes("network")
  ) {
    return "לא הצלחנו להתחבר. בדקו את החיבור לרשת ונסו שוב.";
  }

  if (
    err.code === "invalid_credentials" ||
    lower.includes("invalid login credentials") ||
    lower.includes("invalid email or password")
  ) {
    return "הסיסמה שגויה. נסו שוב.";
  }

  return message.trim() || "שגיאה בהתחברות";
}

/**
 * @param {HTMLElement} root
 * @param {{ api: { getClient: () => import('@supabase/supabase-js').SupabaseClient }, router: { go: (route: string) => void } }} ctx
 */
export function mount(root, ctx) {
  root.innerHTML = `
    <div class="auth-wrap">
      <div class="auth-card">
        <h1 class="auth-title">BookNook</h1>
        <p class="auth-lead">התחברות לספרייה שלך</p>
        <form class="auth-form" novalidate>
          <label class="auth-field">
            <span>אימייל</span>
            <input type="email" name="email" autocomplete="username" inputmode="email" required>
          </label>
          <p class="auth-field-error" data-for="email" hidden></p>
          <label class="auth-field">
            <span>סיסמה</span>
            <input type="password" name="password" autocomplete="current-password" required>
          </label>
          <p class="auth-field-error" data-for="password" hidden></p>
          <p class="auth-form-error" role="alert" hidden></p>
          <button type="submit" class="auth-submit">התחבר</button>
        </form>
        <button type="button" class="auth-forgot">שכחתי סיסמה</button>
        <p class="auth-status" role="status" hidden></p>
      </div>
    </div>
  `;

  const form = root.querySelector(".auth-form");
  const emailInput = root.querySelector('input[name="email"]');
  const passwordInput = root.querySelector('input[name="password"]');
  const formError = root.querySelector(".auth-form-error");
  const statusEl = root.querySelector(".auth-status");
  const submitBtn = root.querySelector(".auth-submit");
  const forgotBtn = root.querySelector(".auth-forgot");
  const fieldErrors = root.querySelectorAll(".auth-field-error");

  /** @param {Record<string, string>} errors */
  function showFieldErrors(errors) {
    fieldErrors.forEach((el) => {
      const key = el.getAttribute("data-for");
      const msg = key ? errors[key] : "";
      if (msg) {
        el.textContent = msg;
        el.hidden = false;
      } else {
        el.textContent = "";
        el.hidden = true;
      }
    });
  }

  function clearMessages() {
    if (formError) {
      formError.textContent = "";
      formError.hidden = true;
    }
    if (statusEl) {
      statusEl.textContent = "";
      statusEl.hidden = true;
    }
    showFieldErrors({});
  }

  async function onSubmit(ev) {
    ev.preventDefault();
    clearMessages();
    const checked = validateLoginForm({
      email: emailInput instanceof HTMLInputElement ? emailInput.value : "",
      password: passwordInput instanceof HTMLInputElement ? passwordInput.value : "",
    });
    if (!checked.ok) {
      showFieldErrors(checked.errors);
      return;
    }

    if (submitBtn instanceof HTMLButtonElement) submitBtn.disabled = true;
    try {
      const client = ctx.api.getClient();
      const { error } = await client.auth.signInWithPassword({
        email: checked.email,
        password: checked.password,
      });
      if (error) throw error;
      ctx.router.go(ROUTES.LIBRARY);
    } catch (err) {
      if (formError) {
        formError.textContent = mapLoginError(err);
        formError.hidden = false;
      }
    } finally {
      if (submitBtn instanceof HTMLButtonElement) submitBtn.disabled = false;
    }
  }

  async function onForgot() {
    clearMessages();
    const email = emailInput instanceof HTMLInputElement ? emailInput.value : "";
    const trimmed = email.trim();
    if (!trimmed) {
      showFieldErrors({ email: "נא להזין כתובת אימייל לשחזור" });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      showFieldErrors({ email: "כתובת אימייל לא תקינה" });
      return;
    }

    if (forgotBtn instanceof HTMLButtonElement) forgotBtn.disabled = true;
    try {
      const client = ctx.api.getClient();
      const redirectTo = `${location.origin}${location.pathname}`;
      const { error } = await client.auth.resetPasswordForEmail(trimmed, { redirectTo });
      if (error) throw error;
      if (statusEl) {
        statusEl.textContent = "שלחנו לכם קישור לאיפוס הסיסמה באימייל.";
        statusEl.hidden = false;
      }
    } catch (err) {
      if (formError) {
        formError.textContent = mapLoginError(err);
        formError.hidden = false;
      }
    } finally {
      if (forgotBtn instanceof HTMLButtonElement) forgotBtn.disabled = false;
    }
  }

  form?.addEventListener("submit", onSubmit);
  forgotBtn?.addEventListener("click", onForgot);

  return () => {
    form?.removeEventListener("submit", onSubmit);
    forgotBtn?.removeEventListener("click", onForgot);
  };
}

/**
 * @param {{ getSession: () => Promise<import('@supabase/supabase-js').Session|null> }} api
 * @returns {Promise<import('@supabase/supabase-js').Session|null>}
 */
export async function requireSession(api) {
  const session = await api.getSession();
  if (!session) {
    if (location.hash !== ROUTES.LOGIN) {
      location.hash = ROUTES.LOGIN;
    }
    return null;
  }
  return session;
}

/**
 * Reads the fragment Supabase appends to invite and password-reset links:
 * `#access_token=…&type=invite|recovery` on success, `#error=…` when the link
 * is expired or already used.
 * @param {string} hash
 * @returns {{ kind: "session", type: string } | { kind: "error", message: string } | null}
 */
export function parseAuthRedirect(hash) {
  const params = new URLSearchParams(String(hash ?? "").replace(/^#/, ""));
  if (params.has("access_token")) return { kind: "session", type: params.get("type") ?? "" };
  if (params.has("error") || params.has("error_description")) {
    return { kind: "error", message: params.get("error_description") ?? params.get("error") ?? "" };
  }
  return null;
}

/** Invite and recovery links sign the user in without a password; they must choose one. */
export function needsNewPassword(redirect) {
  return redirect?.kind === "session" && (redirect.type === "invite" || redirect.type === "recovery");
}

/**
 * @param {{ password?: string, confirm?: string }} fields
 */
export function validateNewPassword(fields) {
  const password = String(fields.password ?? "");
  const errors = {};
  if (password.length < 6) errors.password = "הסיסמה צריכה להכיל לפחות 6 תווים";
  else if (password !== String(fields.confirm ?? "")) errors.confirm = "הסיסמאות אינן תואמות";
  return { ok: Object.keys(errors).length === 0, errors, password };
}

/**
 * Set-password form shown after an invite or password-reset link. After an
 * invite it then asks for the display name shown in the library title.
 * @param {HTMLElement} root
 * @param {{ api: { getClient: () => import('@supabase/supabase-js').SupabaseClient } }} ctx
 * @param {() => void} onDone called after the password (and name) are saved
 * @param {{ askName?: boolean }} [options]
 */
export function mountSetPassword(root, ctx, onDone, options = {}) {
  root.innerHTML = `
    <div class="auth-wrap">
      <div class="auth-card">
        <h1 class="auth-title">BookNook</h1>
        <p class="auth-lead">בחרו סיסמה לספרייה שלכם</p>
        <form class="auth-form" novalidate>
          <label class="auth-field">
            <span>סיסמה חדשה</span>
            <input type="password" name="password" autocomplete="new-password" required>
          </label>
          <p class="auth-field-error" data-for="password" hidden></p>
          <label class="auth-field">
            <span>אימות סיסמה</span>
            <input type="password" name="confirm" autocomplete="new-password" required>
          </label>
          <p class="auth-field-error" data-for="confirm" hidden></p>
          <p class="auth-form-error" role="alert" hidden></p>
          <button type="submit" class="auth-submit">שמירה</button>
        </form>
      </div>
    </div>
  `;
  const form = root.querySelector(".auth-form");
  const submitBtn = root.querySelector(".auth-submit");
  const formError = root.querySelector(".auth-form-error");
  const fieldErrors = root.querySelectorAll(".auth-field-error");

  form?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const value = (name) => {
      const el = root.querySelector(`input[name="${name}"]`);
      return el instanceof HTMLInputElement ? el.value : "";
    };
    const checked = validateNewPassword({ password: value("password"), confirm: value("confirm") });
    fieldErrors.forEach((el) => {
      const msg = checked.errors[el.getAttribute("data-for") ?? ""] ?? "";
      el.textContent = msg;
      el.hidden = !msg;
    });
    if (formError) formError.hidden = true;
    if (!checked.ok) return;
    if (submitBtn instanceof HTMLButtonElement) submitBtn.disabled = true;
    try {
      const { error } = await ctx.api.getClient().auth.updateUser({ password: checked.password });
      if (error) throw error;
      if (options.askName) void mountDisplayNameStep(root, ctx, onDone);
      else onDone();
    } catch (err) {
      if (formError) {
        formError.textContent = mapLoginError(err);
        formError.hidden = false;
      }
      if (submitBtn instanceof HTMLButtonElement) submitBtn.disabled = false;
    }
  });
}

/**
 * Second invite step: choose the display name ("הספרייה של …").
 * @param {HTMLElement} root
 * @param {{ api: { getClient: () => import('@supabase/supabase-js').SupabaseClient } }} ctx
 * @param {() => void} onDone
 */
async function mountDisplayNameStep(root, ctx, onDone) {
  const client = ctx.api.getClient();
  const current = await loadProfile(client).catch(() => "");
  root.innerHTML = `
    <div class="auth-wrap">
      <div class="auth-card">
        <h1 class="auth-title">BookNook</h1>
        <p class="auth-lead">איך לקרוא לכם? השם יופיע בכותרת הספרייה</p>
        <form class="auth-form" novalidate>
          <label class="auth-field">
            <span>שם תצוגה</span>
            <input type="text" name="display_name" autocomplete="nickname" required>
          </label>
          <p class="auth-field-error" data-for="display_name" hidden></p>
          <p class="auth-form-error" role="alert" hidden></p>
          <button type="submit" class="auth-submit">המשך לספרייה</button>
        </form>
      </div>
    </div>
  `;
  const input = root.querySelector('input[name="display_name"]');
  const fieldError = root.querySelector(".auth-field-error");
  const formError = root.querySelector(".auth-form-error");
  const submitBtn = root.querySelector(".auth-submit");
  if (input instanceof HTMLInputElement) {
    input.value = current;
    input.focus();
    input.select();
  }
  root.querySelector(".auth-form")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const checked = validateDisplayName(input instanceof HTMLInputElement ? input.value : "");
    if (fieldError) {
      fieldError.textContent = checked.ok ? "" : checked.error;
      fieldError.hidden = checked.ok;
    }
    if (formError) formError.hidden = true;
    if (!checked.ok) return;
    if (submitBtn instanceof HTMLButtonElement) submitBtn.disabled = true;
    try {
      await saveDisplayName(client, checked.value);
      onDone();
    } catch (err) {
      if (formError) {
        formError.textContent = err instanceof Error ? err.message : "לא הצלחנו לשמור";
        formError.hidden = false;
      }
      if (submitBtn instanceof HTMLButtonElement) submitBtn.disabled = false;
    }
  });
}
