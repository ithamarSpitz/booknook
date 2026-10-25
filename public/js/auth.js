import { ROUTES } from "./contract.js";

/** @param {HTMLElement} _root @param {object} _ctx */
export function mount(_root, _ctx) {}

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
