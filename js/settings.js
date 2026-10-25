import { ROUTES } from "./contract.js?v=02bfe78";
import { libraryTitle, saveDisplayName } from "./data.js?v=02bfe78";

/**
 * @param {string | null | undefined} name
 */
export function validateDisplayName(name) {
  const value = String(name ?? "").trim();
  if (!value) {
    return { ok: false, error: "נא להזין שם תצוגה" };
  }
  return { ok: true, value };
}

/**
 * @param {HTMLElement} root
 * @param {object} ctx
 */
export async function mount(root, ctx) {
  const api = ctx.api;
  const client = api.getClient();
  let displayName = "";

  try {
    displayName = await ctx.data.loadProfile(client);
  } catch {
    displayName = ctx.getLibrary?.()?.displayName ?? "";
  }

  root.innerHTML = `
    <div class="settings-wrap">
      <h1 class="settings-title">הגדרות</h1>
      <form class="settings-form" novalidate>
        <label class="settings-field">
          <span>שם תצוגה</span>
          <input type="text" name="displayName" maxlength="120" autocomplete="nickname" value="">
        </label>
        <p class="settings-field-error" role="alert" hidden></p>
        <button type="submit" class="settings-save">שמירה</button>
      </form>
      <button type="button" class="settings-logout">התנתק</button>
    </div>
  `;

  const form = root.querySelector(".settings-form");
  const nameInput = root.querySelector('input[name="displayName"]');
  const fieldError = root.querySelector(".settings-field-error");
  const saveBtn = root.querySelector(".settings-save");
  const logoutBtn = root.querySelector(".settings-logout");

  if (nameInput instanceof HTMLInputElement) {
    nameInput.value = displayName;
  }

  function syncLibraryTitle(name) {
    const doorTitle = document.querySelector(".door-panel h2");
    if (doorTitle) doorTitle.textContent = libraryTitle(name);
    const lib = ctx.getLibrary?.();
    if (lib && ctx.setLibrary) {
      ctx.setLibrary({ ...lib, displayName: name });
    }
    const libScreen = document.getElementById("screen-library");
    if (libScreen && !libScreen.hidden && typeof ctx.redrawLibrary === "function") {
      void ctx.redrawLibrary();
    }
  }

  async function onSubmit(ev) {
    ev.preventDefault();
    if (fieldError) {
      fieldError.textContent = "";
      fieldError.hidden = true;
    }
    const raw = nameInput instanceof HTMLInputElement ? nameInput.value : "";
    const checked = validateDisplayName(raw);
    if (!checked.ok) {
      if (fieldError && checked.error) {
        fieldError.textContent = checked.error;
        fieldError.hidden = false;
      }
      return;
    }

    if (saveBtn instanceof HTMLButtonElement) saveBtn.disabled = true;
    const previous = displayName;
    displayName = checked.value;
    syncLibraryTitle(displayName);

    try {
      await saveDisplayName(client, checked.value);
      ctx.showToast?.("השם נשמר");
    } catch (err) {
      displayName = previous;
      syncLibraryTitle(previous);
      if (nameInput instanceof HTMLInputElement) nameInput.value = previous;
      const msg = err instanceof Error ? err.message : "לא הצלחנו לשמור";
      ctx.showToast?.(msg);
    } finally {
      if (saveBtn instanceof HTMLButtonElement) saveBtn.disabled = false;
    }
  }

  async function onLogout() {
    if (logoutBtn instanceof HTMLButtonElement) logoutBtn.disabled = true;
    try {
      await client.auth.signOut();
      if (ctx.setLibrary) ctx.setLibrary(null);
      ctx.router?.go(ROUTES.LOGIN);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "לא הצלחנו להתנתק";
      ctx.showToast?.(msg);
    } finally {
      if (logoutBtn instanceof HTMLButtonElement) logoutBtn.disabled = false;
    }
  }

  form?.addEventListener("submit", onSubmit);
  logoutBtn?.addEventListener("click", onLogout);

  return () => {
    form?.removeEventListener("submit", onSubmit);
    logoutBtn?.removeEventListener("click", onLogout);
  };
}
