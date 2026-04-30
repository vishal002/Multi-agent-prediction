import { createClient } from "@supabase/supabase-js";

/** @returns {import("@supabase/supabase-js").SupabaseClient | null} */
export function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {number} maxRows
 * @returns {Promise<{ share_id: string, pack: Record<string, unknown>, created: number }[]>}
 */
export async function sharePacksLoadRecent(client, maxRows) {
  const { data, error } = await client
    .from("share_packs")
    .select("share_id, pack, created_at")
    .order("created_at", { ascending: true })
    .limit(maxRows);
  if (error) {
    console.warn("[supabase share] load:", error.message);
    return [];
  }
  const out = [];
  for (const row of data || []) {
    const id = String(row.share_id || "").toLowerCase();
    const pack = row.pack;
    const created = row.created_at ? Date.parse(row.created_at) : Date.now();
    if (id && pack && typeof pack === "object") out.push({ share_id: id, pack, created });
  }
  return out;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {string} shareId
 * @param {Record<string, unknown>} pack
 */
export async function sharePackInsert(client, shareId, pack) {
  const { error } = await client.from("share_packs").insert({ share_id: shareId, pack });
  if (error) console.warn("[supabase share] insert:", error.message);
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {string} shareId
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function sharePackGet(client, shareId) {
  const { data, error } = await client.from("share_packs").select("pack").eq("share_id", shareId).maybeSingle();
  if (error) {
    console.warn("[supabase share] get:", error.message);
    return null;
  }
  const p = data?.pack;
  return p && typeof p === "object" ? /** @type {Record<string, unknown>} */ (p) : null;
}
