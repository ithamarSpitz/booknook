import { ROUTES } from "./contract.js?v=234f94d";

const ROUTE_SET = new Set(Object.values(ROUTES));

/**
 * @param {{ onRoute: (hash: string) => void | Promise<void> }} options
 */
export function createRouter({ onRoute }) {
  function normalize(hash = location.hash) {
    if (!hash || !ROUTE_SET.has(hash)) {
      return ROUTES.LIBRARY;
    }
    return hash;
  }

  function go(route) {
    location.hash = route;
  }

  let cleanup = null;

  function start() {
    const handle = () => {
      const route = normalize();
      if (location.hash !== route) {
        location.hash = route;
        return;
      }
      void Promise.resolve(onRoute(route));
    };
    addEventListener("hashchange", handle);
    queueMicrotask(() => {
      if (!location.hash) {
        location.hash = ROUTES.LIBRARY;
      } else {
        handle();
      }
    });
    return {
      go,
      current: () => normalize(),
      setCleanup(fn) {
        cleanup = fn;
      },
      async runCleanup() {
        if (cleanup) {
          const fn = cleanup;
          cleanup = null;
          await fn();
        }
      },
    };
  }

  return { start, go, normalize };
}
