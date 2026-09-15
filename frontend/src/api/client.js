import axios from "axios";
import { askReason } from "../utils/reasonPrompt";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

const client = axios.create({
  baseURL: API_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

// Request interceptor - add auth token
client.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor - handle errors
client.interceptors.response.use(
  (response) => response,
  async (error) => {
    // HR / Accounting changes that must be explained (pay, a correction to
    // someone else's attendance, a deletion) come back 400 needs_reason. Ask
    // once, then resend the very same request with the reason attached. Only
    // those module routes ever send needs_reason, so nothing else changes.
    const nr = error.response?.data;
    if (error.response?.status === 400 && nr?.needs_reason && error.config && !error.config.__reasonAsked) {
      const reason = await askReason(nr.error);
      if (reason) {
        const cfg = { ...error.config, __reasonAsked: true };
        if ((cfg.method || 'get').toLowerCase() === 'get') {
          cfg.params = { ...(cfg.params || {}), change_reason: reason };
        } else {
          let body = cfg.data;
          if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
          cfg.data = { ...(body || {}), change_reason: reason };
        }
        return client(cfg);
      }
    }
    // IP access control (mig 319): this network may not use the CRM. The server
    // has already revoked the session; drop it here too and send the person to
    // the login page with the reason. On the login page itself the error is
    // shown by the form, so no redirect and no notice.
    if (error.response?.status === 403 && error.response?.data?.code === 'IP_BLOCKED') {
      if (!window.location.pathname.startsWith('/login')) {
        try { sessionStorage.setItem('auth_notice', error.response.data.error || 'Access from your current network is not permitted.'); } catch { /* storage blocked */ }
        localStorage.removeItem("token");
        localStorage.removeItem("refresh_token");
        localStorage.removeItem("user");
        window.location.href = "/login";
      }
      return Promise.reject(error);
    }
    if (error.response?.status === 401) {
      // Token expired or invalid
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      window.location.href = "/login";
    }
    // Read-only write blocked with the alert turned OFF by a superadmin
    // (governance flag show_write_blocked_alert=false). The backend still
    // refused the write — the source of truth is unchanged — but the operator
    // chose to hide the "read-only" tell. Resolve a benign synthetic success so
    // no component surfaces an error banner. `readonly_write_blocked` + the
    // server-computed `show_alert:false` drive this; when show_alert is true we
    // fall through and the normal error (and its alert) propagates.
    const d = error.response?.data;
    if (error.response?.status === 403 && d?.readonly_write_blocked && d?.show_alert === false) {
      return Promise.resolve({
        data: { ok: true, readonly_noop: true },
        status: 200, statusText: 'OK', headers: {}, config: error.config,
      });
    }
    return Promise.reject(error);
  }
);

export default client;
