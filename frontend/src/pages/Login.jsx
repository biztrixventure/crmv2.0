import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";
import { getRoleRoute } from "../utils/roleRouting";
import { Moon, Sun, Lock, Mail, ArrowRight, Shield } from "lucide-react";
import { Alert } from "../components/UI";
import client from "../api/client";
import DevCredit from "../components/DevCredit";

const Login = () => {
  const navigate = useNavigate();
  const { login } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const response = await client.post("auth/login", { email, password });
      if (response.data.token && response.data.user) {
        login(response.data.user, response.data.token, response.data.refresh_token);
        navigate(getRoleRoute(response.data.user.role));
      }
    } catch (err) {
      setError(err.response?.data?.error || "Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex relative overflow-hidden"
      style={{ background: "var(--color-bg)", fontFamily: "var(--font-sans)" }}
    >
      {/* Theme toggle */}
      <button
        onClick={toggleTheme}
        className="absolute top-5 right-5 z-20 p-2.5 rounded-xl transition-all duration-300 hover:scale-105"
        style={{
          backgroundColor: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          boxShadow: "var(--shadow-sm)",
        }}
        aria-label="Toggle theme"
      >
        {theme === "light" ? (
          <Moon size={18} style={{ color: "var(--color-text)" }} />
        ) : (
          <Sun size={18} style={{ color: "var(--color-text)" }} />
        )}
      </button>

      {/* ── Left brand panel (desktop only) ── */}
      <div
        className="hidden lg:flex lg:w-[45%] relative flex-col justify-between p-14 overflow-hidden"
        style={{
          background:
            "linear-gradient(145deg, #2E1A08 0%, #6B3D14 55%, #3D2208 100%)",
        }}
      >
        {/* Decorative geometry */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div
            className="absolute -top-28 -right-28 w-96 h-96 rounded-full"
            style={{ border: "1px solid rgba(196, 137, 74, 0.12)" }}
          />
          <div
            className="absolute top-[40%] -right-12 w-52 h-52 rounded-full"
            style={{
              background:
                "radial-gradient(circle, rgba(196, 137, 74, 0.06) 0%, transparent 70%)",
            }}
          />
          <div
            className="absolute -bottom-24 -left-24 w-80 h-80 rounded-full"
            style={{ border: "1px solid rgba(196, 137, 74, 0.07)" }}
          />
          <div
            className="absolute bottom-0 left-0 right-0 h-48"
            style={{
              background:
                "linear-gradient(0deg, rgba(0,0,0,0.35) 0%, transparent 100%)",
            }}
          />
        </div>

        {/* Top — logo */}
        <div className="relative z-10">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center mb-4"
            style={{
              backgroundColor: "rgba(196, 137, 74, 0.18)",
              border: "1px solid rgba(196, 137, 74, 0.35)",
            }}
          >
            <span
              style={{
                fontSize: "1.2rem",
                fontWeight: 900,
                color: "white",
                fontFamily: "var(--font-display)",
              }}
            >
              B
            </span>
          </div>
          <span
            style={{
              fontSize: "0.68rem",
              fontWeight: 700,
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              color: "rgba(196, 137, 74, 0.6)",
            }}
          >
            BizTrix
          </span>
        </div>

        {/* Middle — headline */}
        <div className="relative z-10">
          <h1
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "3.75rem",
              fontWeight: 700,
              lineHeight: 1.06,
              letterSpacing: "-0.03em",
              color: "white",
              margin: 0,
            }}
          >
            Close more.
            <br />
            <span style={{ color: "rgba(212, 160, 96, 0.9)" }}>
              Track everything.
            </span>
          </h1>
          <p
            style={{
              marginTop: "1.5rem",
              fontSize: "0.9375rem",
              lineHeight: 1.75,
              color: "rgba(225, 185, 130, 0.65)",
              maxWidth: "330px",
              marginBottom: 0,
            }}
          >
            The CRM built for high-velocity sales teams. Manage leads, track
            calls, and close deals — all in one place.
          </p>
        </div>

        {/* Bottom — security note */}
        <div className="relative z-10 flex items-center gap-2">
          <Shield size={13} style={{ color: "rgba(196, 137, 74, 0.45)" }} />
          <span
            style={{
              fontSize: "0.68rem",
              color: "rgba(196, 137, 74, 0.4)",
              letterSpacing: "0.05em",
            }}
          >
            Enterprise-grade security
          </span>
        </div>
      </div>

      {/* ── Right form panel ── */}
      <div
        className="flex-1 flex flex-col items-center justify-center px-6 py-16 sm:px-12 lg:px-16"
        style={{ minHeight: "100vh" }}
      >
        {/* Mobile branding */}
        <div className="lg:hidden mb-10 text-center">
          <h1
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "2rem",
              fontWeight: 700,
              color: "var(--color-text)",
              letterSpacing: "-0.02em",
              margin: 0,
            }}
          >
            BizTrix{" "}
            <span style={{ color: "var(--color-primary-500)" }}>CRM</span>
          </h1>
          <p
            className="text-sm mt-1"
            style={{ color: "var(--color-text-secondary)" }}
          >
            Customer Relationship Management
          </p>
        </div>

        <div className="w-full max-w-[360px] animate-fade-in">
          <div className="mb-8">
            <h2
              style={{
                fontSize: "1.6rem",
                fontWeight: 700,
                color: "var(--color-text)",
                letterSpacing: "-0.02em",
                lineHeight: 1.2,
                margin: 0,
              }}
            >
              Welcome back
            </h2>
            <p
              className="text-sm mt-1.5"
              style={{ color: "var(--color-text-secondary)", margin: "0.375rem 0 0 0" }}
            >
              Sign in to your account to continue
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
            {error && (
              <Alert
                type="error"
                title="Sign in failed"
                message={error}
                dismissible
                onDismiss={() => setError("")}
              />
            )}

            <div>
              <label
                className="block text-sm font-semibold mb-2"
                style={{ color: "var(--color-text)" }}
              >
                Email Address
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                  <Mail size={16} style={{ color: "var(--color-text-tertiary)" }} />
                </div>
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input pl-10"
                  placeholder="you@example.com"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label
                  className="block text-sm font-semibold"
                  style={{ color: "var(--color-text)" }}
                >
                  Password
                </label>
                <Link
                  to="/forgot-password"
                  className="text-xs font-medium transition-colors hover:underline"
                  style={{ color: "var(--color-primary-500)" }}
                >
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                  <Lock size={16} style={{ color: "var(--color-text-tertiary)" }} />
                </div>
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input pl-10"
                  placeholder="••••••••"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 rounded-xl font-semibold transition-all duration-200 flex items-center justify-center gap-2 group"
              style={{
                background: loading
                  ? "var(--color-disabled-bg)"
                  : "linear-gradient(135deg, var(--color-primary-700), var(--color-primary-500))",
                boxShadow: loading ? "none" : "0 4px 14px rgba(196, 137, 74, 0.28)",
                cursor: loading ? "not-allowed" : "pointer",
                color: loading ? "var(--color-disabled-text)" : "white",
              }}
            >
              {loading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
                  <span>Signing in...</span>
                </>
              ) : (
                <>
                  <span>Sign In</span>
                  <ArrowRight
                    size={16}
                    className="group-hover:translate-x-1 transition-transform"
                  />
                </>
              )}
            </button>

            <p
              className="text-center text-sm pt-1"
              style={{ color: "var(--color-text-tertiary)" }}
            >
              Don't have an account?{" "}
              <span
                className="font-semibold"
                style={{ color: "var(--color-primary-500)" }}
              >
                Contact your admin
              </span>
            </p>
          </form>
          <DevCredit />
        </div>
      </div>
    </div>
  );
};

export default Login;
