import { requireUser, serviceClient } from "../_shared/db.ts";
import type { InviteUserRequest, InviteUserResponse } from "../_shared/types.ts";
import {
  body,
  errorResponse,
  HttpError,
  json,
  options,
} from "../_shared/utils.ts";

/** Invitations one user may send per 24 hours (protects the mail quota). */
export const DAILY_LIMIT = 10;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type InviteDb = {
  from(table: string): any;
  auth: {
    admin: {
      inviteUserByEmail(
        email: string,
        options: { data: Record<string, unknown> },
      ): Promise<{ data: unknown; error: { message?: string; status?: number; code?: string } | null }>;
    };
  };
};

type FunctionDeps = {
  requireUser: typeof requireUser;
  serviceClient: () => InviteDb;
  now: () => Date;
};

const defaults: FunctionDeps = {
  requireUser,
  serviceClient: serviceClient as unknown as () => InviteDb,
  now: () => new Date(),
};

function inviteFailure(error: { message?: string; status?: number; code?: string }): never {
  const message = error.message ?? "";
  if (error.code === "email_exists" || /already (been )?registered|already exists/i.test(message)) {
    throw new HttpError(409, "לכתובת הזו כבר יש חשבון ב־BookNook.");
  }
  if (/not authorized/i.test(message)) {
    // Supabase's built-in mailer only sends to the project team; custom SMTP lifts it.
    throw new HttpError(502, "שליחת המייל נחסמה: שרת הדואר עדיין לא הוגדר לשליחה לכל כתובת.");
  }
  if (error.status === 429 || /rate limit/i.test(message)) {
    throw new HttpError(429, "נשלחו יותר מדי מיילים בזמן קצר. נסו שוב בעוד שעה.");
  }
  throw new HttpError(502, message || "שליחת ההזמנה נכשלה.");
}

// Any signed-in reader may invite a friend by email. The invite email names the
// inviter ({{ .Data.inviter_name }} in the Supabase "Invite user" template) and
// lands on the site's set-password and display-name steps.
export function createHandler(overrides: Partial<FunctionDeps> = {}) {
  const deps = { ...defaults, ...overrides };
  return async (req: Request): Promise<Response> => {
    const preflight = options(req);
    if (preflight) return preflight;
    try {
      const userId = await deps.requireUser(req);
      const input = await body<Partial<InviteUserRequest>>(req);
      const email = String(input.email ?? "").trim().toLowerCase();
      if (!EMAIL.test(email) || email.length > 254) {
        throw new HttpError(400, "כתובת אימייל לא תקינה.");
      }

      const db = deps.serviceClient();
      const since = new Date(deps.now().getTime() - 86_400_000).toISOString();
      const recent = await db.from("invitations").select("id", { count: "exact", head: true })
        .eq("inviter_id", userId).gte("created_at", since);
      if (recent.error) throw new Error(recent.error.message);
      if ((recent.count ?? 0) >= DAILY_LIMIT) {
        throw new HttpError(429, `אפשר לשלוח עד ${DAILY_LIMIT} הזמנות ביום. נסו שוב מחר.`);
      }

      const profile = await db.from("profiles").select("display_name").eq("id", userId).maybeSingle();
      if (profile.error) throw new Error(profile.error.message);
      const inviterName = String(profile.data?.display_name ?? "").trim() || "חבר או חברה";

      const invited = await db.auth.admin.inviteUserByEmail(email, {
        data: { inviter_name: inviterName, invited_by: userId },
      });
      if (invited.error) inviteFailure(invited.error);

      const stored = await db.from("invitations").insert({ inviter_id: userId, email })
        .select("email,created_at").single();
      if (stored.error) throw new Error(stored.error.message);
      const response: InviteUserResponse = { invitation: stored.data };
      return json(response);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export const handler = createHandler();
if (import.meta.main) Deno.serve(handler);
