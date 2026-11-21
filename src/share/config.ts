/**
 * Where the hosted API lives. Set VITE_API_BASE at build time (for example https://ashby-planner-api.<you>.workers.dev).
 * Without it the app runs on its own: the dev server still serves share links, and a deployed copy has none.
 */
export const API_BASE: string = ((import.meta.env.VITE_API_BASE as string | undefined) ?? '').replace(/\/+$/, '');
export const SHARE_BASE = API_BASE ? `${API_BASE}/api/share` : '/api/share';
/** Share links need either the hosted API or the dev server's file store. */
export const SHARING_ENABLED = !!API_BASE || import.meta.env.DEV;
/** Cloud backup of scenarios needs the hosted API. */
export const CLOUD_ENABLED = !!API_BASE;
