import * as api from "./api.js?v=1844a00";
import { ROUTES } from "./contract.js?v=1844a00";
import { createRouter } from "./router.js?v=1844a00";
import * as data from "./data.js?v=1844a00";
import * as library from "./library.js?v=1844a00";
import { createCard } from "./card.js?v=1844a00";
import * as auth from "./auth.js?v=1844a00";
import * as settings from "./settings.js?v=1844a00";
import * as recs from "./recs.js?v=1844a00";
import * as addBook from "./add-book.js?v=1844a00";
import * as invite from "./invite.js?v=1844a00";
import { createRecsRefresher } from "./recs-refresh.js?v=1844a00";
import { SHELVES_CHANGED } from "./events.js?v=1844a00";

/** @type {import('./data.js?v=1844a00').LibraryState | null} */
let libraryState = null;

const toastEl = document.getElementById("toast");
let toastTimer = 0;

function showToast(message) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.hidden = true;
  }, 4000);
}

async function refreshLibrary() {
  libraryState = await data.loadLibrary(api.getClient());
  return libraryState;
}

const screens = {
  [ROUTES.LIBRARY]: document.getElementById("screen-library"),
  [ROUTES.RECOMMENDATIONS]: document.getElementById("screen-recs"),
  [ROUTES.SEARCH]: document.getElementById("screen-search"),
  [ROUTES.SETTINGS]: document.getElementById("screen-settings"),
  [ROUTES.INVITE]: document.getElementById("screen-invite"),
  [ROUTES.LOGIN]: document.getElementById("screen-login"),
};

const mounts = {
  [ROUTES.LIBRARY]: library,
  [ROUTES.RECOMMENDATIONS]: recs,
  [ROUTES.SEARCH]: addBook,
  [ROUTES.SETTINGS]: settings,
  [ROUTES.INVITE]: invite,
  [ROUTES.LOGIN]: auth,
};

const ctx = {
  api,
  data,
  router: null,
  card: null,
  getLibrary: () => libraryState,
  setLibrary: (s) => {
    libraryState = s;
  },
  showToast,
  recsRefresh: createRecsRefresher({ callFunction: api.callFunction }),
};

// Any book landing on a shelf regenerates recommendations quietly in the background.
document.addEventListener(SHELVES_CHANGED, () => ctx.recsRefresh.request());

async function redrawLibrary() {
  const libRoot = screens[ROUTES.LIBRARY];
  if (libRoot) await library.mount(libRoot, ctx);
  updateMenuTitle();
}

ctx.redrawLibrary = redrawLibrary;
ctx.reloadLibrary = async () => {
  libraryState = await data.loadLibrary(api.getClient());
  await redrawLibrary();
};

ctx.card = createCard(document.getElementById("bk"), {
  api,
  data,
  showToast,
  getLibrary: () => libraryState,
  setLibrary: (s) => {
    libraryState = s;
  },
  onLibraryChange: async () => {
    const libRoot = screens[ROUTES.LIBRARY];
    if (libRoot && !libRoot.hidden) await library.mount(libRoot, ctx);
    updateMenuTitle();
  },
});

function updateMenuTitle() {
  const doorTitle = document.querySelector(".door-panel h2");
  if (doorTitle) doorTitle.textContent = data.libraryTitle(libraryState?.displayName);
  document.querySelectorAll(".door-panel nav a").forEach((a) => {
    const route = a.getAttribute("href");
    if (route === location.hash) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
}

const pageMenu = document.getElementById("page-menu");
pageMenu?.addEventListener("click", () => library.openMenu());

function showScreen(route) {
  for (const [hash, el] of Object.entries(screens)) {
    if (!el) continue;
    el.hidden = hash !== route;
  }
  // The library has its own burger in the crown; the other signed-in screens need one too.
  if (pageMenu) pageMenu.hidden = route === ROUTES.LIBRARY || route === ROUTES.LOGIN;
}

let routerCtl = null;

async function onRoute(route) {
  await routerCtl?.runCleanup();

  if (route === ROUTES.LOGIN) {
    const session = await api.getSession();
    if (session) {
      routerCtl?.go(ROUTES.LIBRARY);
      return;
    }
    showScreen(route);
    const cleanup = await mounts[route].mount(screens[route], ctx);
    if (typeof cleanup === "function") routerCtl?.setCleanup(cleanup);
    updateMenuTitle();
    return;
  }

  const session = await auth.requireSession(api);
  if (!session) return;

  showScreen(route);
  updateMenuTitle();

  if (route === ROUTES.LIBRARY) {
    const caseEl = document.getElementById("case");
    if (caseEl) {
      caseEl.innerHTML = `<p class="empty" role="status">טוען…</p>`;
    }
    try {
      libraryState = await refreshLibrary();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "לא הצלחנו לטעון את הספרייה");
      libraryState = { displayName: "", shelves: [], error: "לא הצלחנו לטעון את הספרייה" };
    }
  }

  const mod = mounts[route];
  const root = screens[route];
  if (mod && root) {
    const cleanup = await mod.mount(root, ctx);
    if (typeof cleanup === "function") routerCtl?.setCleanup(cleanup);
  }
  updateMenuTitle();
}

const router = createRouter({ onRoute });

async function start() {
  // An invite or password-reset link puts the session in the URL fragment.
  // Let supabase-js read it before the router rewrites the hash to a route.
  const redirect = auth.parseAuthRedirect(location.hash);
  if (redirect) {
    const session = await api.getSession();
    history.replaceState(null, "", location.pathname + location.search);
    if (redirect.kind === "error") {
      showToast("הקישור אינו תקף או שפג תוקפו. בקשו קישור חדש בעזרת \"שכחתי סיסמה\".");
    } else if (session && auth.needsNewPassword(redirect)) {
      showScreen(ROUTES.LOGIN);
      await new Promise((resolve) => auth.mountSetPassword(screens[ROUTES.LOGIN], ctx, resolve, {
        askName: redirect.type === "invite",
      }));
    }
  }
  routerCtl = router.start();
  ctx.router = routerCtl;
}

void start();

// Installable as an app (Chrome needs a service worker); offline shell fallback.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
