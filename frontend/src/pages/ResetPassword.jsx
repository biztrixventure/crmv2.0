import React, { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTheme } from "../contexts/ThemeContext";
import { Moon, Sun, Lock, ArrowLeft, Shield, CheckCircle, AlertCircle } from "lucide-react";
import { Alert } from "../components/UI";
import client from "../api/client";
import DevCredit from "../components/DevCredit";

const ResetPassword = () => {
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [tokenHash, setTokenHash] = useState("");
  const [tokenError, setTokenError] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  // Extract token_hash from URL on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const hash = params.get("token_hash") || params.get("token");

    // Supabase also puts the token in the URL hash fragment
    if (!hash) {
      const hashParams = new URLSearchParams(window.location.hash.replace("#", "?"));
      const accessToken = hashParams.get("access_token");
      if (accessToken) {
        setTokenHash(accessToken);
        return;
      }
      setTokenError(true);
      return;
    }
    setTokenHash(hash);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      await client.post("auth/reset-password", {
        token_hash: tokenHash,
        new_password: password,
      });
      setSuccess(true);
      setTimeout(() => navigate("/login"), 3000);
    } catch (err) {
      setError(err.response?.data?.error || "Password reset failed. The link may have expired.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4 py-12 sm:px-6 lg:px-8 relative overflow-hidden"
      style={{ background: "var(--color-bg)" }}
    >
      {/* Background orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute -top-40 -right-40 w-80 h-80 rounded-full opacity-20"
          style={{ background: "radial-gradient(circle, var(--color-primary-400), transparent 70%)", animation: "pulse 4s ease-in-out infinite" }}
        />
        <div
          className="absolute -bottom-40 -left-40 w-96 h-96 rounded-full opacity-15"
          style={{ background: "radial-gradient(circle, var(--color-accent), transparent 70%)", animation: "pulse 5s ease-in-out infinite 1s" }}
        />
      </div>

      {/* Theme toggle */}
      <button
        onClick={toggleTheme}
        className="absolute top-6 right-6 p-3 rounded-xl transition-all duration-300 hover:scale-110 z-10"
        style={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", boxShadow: "var(--shadow-md)" }}
        aria-label="Toggle dark mode"
      >
        {theme === "light" ? <Moon size={20} style={{ color: "var(--color-text)" }} /> : <Sun size={20} style={{ color: "var(--color-text)" }} />}
      </button>

      <div className="w-full max-w-md space-y-8 relative z-10">
        {/* Logo */}
        <div className="text-center animate-fade-in">
          <div className="flex justify-center mb-6">
            <div
              className="w-20 h-20 rounded-2xl flex items-center justify-center relative"
              style={{ background: "var(--gradient-sidebar)", boxShadow: "var(--shadow-xl)" }}
            >
              <span className="text-4xl font-black text-white tracking-tight">B</span>
              <div
                className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center"
                style={{ backgroundColor: "var(--color-success-500)" }}
              >
                <Shield size={12} className="text-white" />
              </div>
            </div>
          </div>
          <h1 className="text-4xl font-black tracking-tight" style={{ color: "var(--color-text)" }}>
            BizTrix<span style={{ color: "var(--color-primary-500)" }}> CRM</span>
          </h1>
        </div>

        {/* Card */}
        <div
          className="animate-slide-up rounded-2xl p-8"
          style={{
            backgroundColor: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            boxShadow: "var(--shadow-xl)",
            backdropFilter: "blur(20px)",
          }}
        >
          {tokenError ? (
            <div className="text-center space-y-4">
              <div className="flex justify-center">
                <AlertCircle size={48} style={{ color: "var(--color-error-500, #ef4444)" }} />
              </div>
              <h2 className="text-xl font-bold" style={{ color: "var(--color-text)" }}>Invalid reset link</h2>
              <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
                This password reset link is invalid or has expired. Please request a new one.
              </p>
              <Link
                to="/forgot-password"
                className="inline-flex items-center gap-2 mt-4 text-sm font-semibold transition-colors hover:underline"
                style={{ color: "var(--color-primary-500)" }}
              >
                Request new reset link
              </Link>
            </div>
          ) : success ? (
            <div className="text-center space-y-4">
              <div className="flex justify-center">
                <CheckCircle size={48} style={{ color: "var(--color-success-500)" }} />
              </div>
              <h2 className="text-xl font-bold" style={{ color: "var(--color-text)" }}>Password updated!</h2>
              <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
                Your password has been reset. Redirecting to sign in...
              </p>
            </div>
          ) : (
            <>
              <div className="mb-6">
                <h2 className="text-xl font-bold" style={{ color: "var(--color-text)" }}>Set new password</h2>
                <p className="text-sm mt-1" style={{ color: "var(--color-text-secondary)" }}>
                  Enter your new password below.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                {error && (
                  <Alert type="error" title="Reset failed" message={error} dismissible onDismiss={() => setError("")} />
                )}

                <div>
                  <label className="block text-sm font-semibold mb-2" style={{ color: "var(--color-text)" }}>
                    New Password
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Lock size={18} style={{ color: "var(--color-text-tertiary)" }} />
                    </div>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      autoComplete="new-password"
                      className="input pl-10"
                      placeholder="Min. 6 characters"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold mb-2" style={{ color: "var(--color-text)" }}>
                    Confirm Password
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Lock size={18} style={{ color: "var(--color-text-tertiary)" }} />
                    </div>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      autoComplete="new-password"
                      className="input pl-10"
                      placeholder="Re-enter your password"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 px-4 rounded-xl font-semibold text-white transition-all duration-300 flex items-center justify-center gap-2"
                  style={{
                    background: loading ? "var(--color-disabled-bg)" : "var(--gradient-sidebar)",
                    boxShadow: loading ? "none" : "var(--shadow-md)",
                    cursor: loading ? "not-allowed" : "pointer",
                  }}
                >
                  {loading ? (
                    <>
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                      <span>Updating...</span>
                    </>
                  ) : (
                    <span>Update password</span>
                  )}
                </button>

                <div className="text-center pt-2">
                  <Link
                    to="/login"
                    className="inline-flex items-center gap-1 text-sm font-semibold transition-colors hover:underline"
                    style={{ color: "var(--color-primary-500)" }}
                  >
                    <ArrowLeft size={14} />
                    Back to sign in
                  </Link>
                </div>
              </form>
            </>
          )}
          <DevCredit />
        </div>
      </div>
    </div>
  );
};

export default ResetPassword;
