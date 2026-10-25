import * as api from "./api.js";
import { ROUTES } from "./contract.js";
import { createRouter } from "./router.js";
import * as data from "./data.js";
import * as library from "./library.js";
import { createCard } from "./card.js";
import * as auth from "./auth.js";
import * as settings from "./settings.js";
import * as recs from "./recs.js";
import * as addBook from "./add-book.js";

/** @type {import('./data.js').LibraryState | null} */
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
  [ROUTES.LOGIN]: document.getElementById("screen-login"),
};

const mounts = {
  [ROUTES.LIBRARY]: library,
  [ROUTES.RECOMMENDATIONS]: recs,
  [ROUTES.SEARCH]: addBook,
  [ROUTES.SETTINGS]: settings,
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
};

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

function showScreen(route) {
  for (const [hash, el] of Object.entries(screens)) {
    if (!el) continue;
    el.hidden = hash !== route;
  }
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
routerCtl = router.start();
ctx.router = routerCtl;
