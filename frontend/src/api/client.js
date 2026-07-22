import axios from "axios";

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
  (error) => {
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
