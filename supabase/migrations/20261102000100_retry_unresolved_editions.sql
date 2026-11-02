-- Retry editions stored as not_found before the November 2026 resolver fixes.
update public.editions set resolve_status = 'pending', resolved_at = null where work_id is null and resolve_status = 'not_found';
