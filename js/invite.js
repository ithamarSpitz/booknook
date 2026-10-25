import { FUNCTIONS } from "./contract.js?v=5fedd1b";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** @param {string} value */
export function validateInviteEmail(value) {
  const email = String(value ?? "").trim();
  if (!email) return { ok: false, error: "נא להזין כתובת אימייל" };
  if (!EMAIL.test(email)) return { ok: false, error: "כתובת אימייל לא תקינה" };
  return { ok: true, email };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** @param {string} iso */
export function formatInviteDate(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString("he-IL", { day: "numeric", month: "long", year: "numeric" });
}

/**
 * Invite friends: any signed-in reader can send an invitation email
 * (invite-user Edge Function) and see the invitations they sent.
 * @param {HTMLElement} root
 * @param {{ api: { callFunction: Function, getClient: Function }, showToast: (m: string) => void }} ctx
 */
export async function mount(root, ctx) {
  const inner = root.querySelector(".screen-inner") ?? root;
  let alive = true;
  /** @type {{ email: string, created_at: string }[]} */
  let sent = [];

  inner.innerHTML = `
    <div class="invite-wrap">
      <h1 class="invite-title">הזמנת חברים</h1>
      <p class="invite-lead">מכירים מישהו שאוהב לקרוא? שלחו לו הזמנה לתורימיטור. הוא יקבל מייל עם השם שלכם וקישור להצטרפות, יבחר סיסמה ויקבל ספרייה משלו.</p>
      <form class="invite-form" novalidate>
        <label class="invite-field">
          <span>כתובת האימייל של החבר</span>
          <input type="email" name="email" inputmode="email" autocomplete="off" dir="ltr" required>
        </label>
        <p class="invite-error" role="alert" hidden></p>
        <button type="submit" class="invite-submit">שליחת הזמנה</button>
      </form>
      <section class="invite-sent" aria-labelledby="invite-sent-title">
        <h2 id="invite-sent-title">הזמנות ששלחתם</h2>
        <ul class="invite-list" role="list"></ul>
      </section>
    </div>`;

  const form = inner.querySelector(".invite-form");
  const input = inner.querySelector('input[name="email"]');
  const errorEl = inner.querySelector(".invite-error");
  const submit = inner.querySelector(".invite-submit");
  const list = inner.querySelector(".invite-list");

  function renderList() {
    if (!list) return;
    list.innerHTML = sent.length
      ? sent
        .map((row) =>
          `<li><span dir="ltr">${escapeHtml(row.email)}</span><small>${escapeHtml(formatInviteDate(row.created_at))}</small></li>`
        )
        .join("")
      : `<li class="invite-empty">עדיין לא שלחתם הזמנות.</li>`;
  }

  function showError(message) {
    if (!errorEl) return;
    errorEl.textContent = message;
    errorEl.hidden = !message;
  }

  form?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const checked = validateInviteEmail(input instanceof HTMLInputElement ? input.value : "");
    if (!checked.ok) {
      showError(checked.error);
      return;
    }
    showError("");
    if (submit instanceof HTMLButtonElement) {
      submit.disabled = true;
      submit.textContent = "שולח…";
    }
    try {
      const res = await ctx.api.callFunction(FUNCTIONS.INVITE_USER, { email: checked.email });
      if (!alive) return;
      const row = res?.invitation ?? { email: checked.email, created_at: new Date().toISOString() };
      // Re-inviting someone who hasn't joined yet resends the link; keep one row per address.
      sent = [row, ...sent.filter((r) => r.email !== row.email)];
      renderList();
      if (input instanceof HTMLInputElement) input.value = "";
      ctx.showToast(`ההזמנה נשלחה אל ${row.email}`);
    } catch (err) {
      if (alive) showError(err instanceof Error ? err.message : "שליחת ההזמנה נכשלה");
    } finally {
      if (alive && submit instanceof HTMLButtonElement) {
        submit.disabled = false;
        submit.textContent = "שליחת הזמנה";
      }
    }
  });

  try {
    const { data, error } = await ctx.api.getClient()
      .from("invitations").select("email,created_at")
      .order("created_at", { ascending: false }).limit(50);
    if (error) throw error;
    const seen = new Set();
    if (alive) sent = (data ?? []).filter((r) => !seen.has(r.email) && seen.add(r.email));
  } catch {
    // The list is a convenience; sending still works without it.
  }
  if (alive) renderList();

  return () => {
    alive = false;
    inner.innerHTML = "";
  };
}
