import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";
import { getRoleRoute } from "../utils/roleRouting";
import { Moon, Sun, Lock, Mail, ArrowRight, Shield } from "lucide-react";
import { Alert } from "../components/UI";
import client from "../api/client";

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
        login(response.data.user, response.data.token);
        const dashboardRoute = getRoleRoute(response.data.user.role);
        navigate(dashboardRoute);
      }
    } catch (err) {
      setError(err.response?.data?.error || "Login failed. Please try again.");
      console.error("Login error:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12 sm:px-6 lg:px-8 relative overflow-hidden"
         style={{ background: 'var(--color-bg)' }}>

      {/* Animated Background Orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 rounded-full opacity-20"
             style={{ background: 'radial-gradient(circle, var(--color-primary-400), transparent 70%)', animation: 'pulse 4s ease-in-out infinite' }}></div>
        <div className="absolute -bottom-40 -left-40 w-96 h-96 rounded-full opacity-15"
             style={{ background: 'radial-gradient(circle, var(--color-accent), transparent 70%)', animation: 'pulse 5s ease-in-out infinite 1s' }}></div>
        <div className="absolute top-1/4 left-1/4 w-64 h-64 rounded-full opacity-10"
             style={{ background: 'radial-gradient(circle, var(--color-primary-300), transparent 70%)', animation: 'pulse 6s ease-in-out infinite 2s' }}></div>
      </div>

      {/* Theme Toggle */}
      <button
        onClick={toggleTheme}
        className="absolute top-6 right-6 p-3 rounded-xl transition-all duration-300 hover:scale-110 z-10"
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-md)' }}
        title="Toggle dark mode"
        aria-label="Toggle dark mode"
      >
        {theme === "light" ? <Moon size={20} style={{ color: 'var(--color-text)' }} /> : <Sun size={20} style={{ color: 'var(--color-text)' }} />}
      </button>

      <div className="w-full max-w-md space-y-8 relative z-10">
        {/* Logo & Branding */}
        <div className="text-center animate-fade-in">
          <div className="flex justify-center mb-6">
            <div className="w-20 h-20 rounded-2xl flex items-center justify-center relative"
                 style={{ background: 'var(--gradient-sidebar)', boxShadow: 'var(--shadow-xl)' }}>
              <span className="text-4xl font-black text-white tracking-tight">B</span>
              <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center"
                   style={{ backgroundColor: 'var(--color-success-500)' }}>
                <Shield size={12} className="text-white" />
              </div>
            </div>
          </div>
          <h1 className="text-4xl font-black tracking-tight" style={{ color: 'var(--color-text)' }}>
            BizTrix<span style={{ color: 'var(--color-primary-500)' }}> CRM</span>
          </h1>
          <p className="mt-2 text-base" style={{ color: 'var(--color-text-secondary)' }}>
            Customer Relationship Management
          </p>
        </div>

        {/* Login Card with Glassmorphism */}
        <div className="animate-slide-up rounded-2xl p-8"
             style={{
               backgroundColor: 'var(--color-surface)',
               border: '1px solid var(--color-border)',
               boxShadow: 'var(--shadow-xl)',
               backdropFilter: 'blur(20px)',
             }}>

          <div className="mb-6">
            <h2 className="text-xl font-bold" style={{ color: 'var(--color-text)' }}>Welcome back</h2>
            <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>Sign in to your account to continue</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
            {/* Error */}
            {error && (
              <Alert type="error" title="Sign in failed" message={error}
                dismissible={true} onDismiss={() => setError("")} />
            )}

            {/* Email */}
            <div>
              <label className="block text-sm font-semibold mb-2" style={{ color: 'var(--color-text)' }}>Email Address</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Mail size={18} style={{ color: 'var(--color-text-tertiary)' }} />
                </div>
                <input
                  name="email" type="email" autoComplete="email" required
                  value={email} onChange={(e) => setEmail(e.target.value)}
                  className="input pl-10"
                  placeholder="you@example.com"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm font-semibold mb-2" style={{ color: 'var(--color-text)' }}>Password</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock size={18} style={{ color: 'var(--color-text-tertiary)' }} />
                </div>
                <input
                  name="password" type="password" autoComplete="current-password" required
                  value={password} onChange={(e) => setPassword(e.target.value)}
                  className="input pl-10"
                  placeholder="••••••••"
                />
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 rounded-xl font-semibold text-white transition-all duration-300 flex items-center justify-center gap-2 group"
              style={{
                background: loading ? 'var(--color-disabled-bg)' : 'var(--gradient-sidebar)',
                boxShadow: loading ? 'none' : 'var(--shadow-md)',
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
              onMouseEnter={e => { if (!loading) { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = 'var(--shadow-lg)'; }}}
              onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'var(--shadow-md)'; }}
            >
              {loading ? (
                <>
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                  <span>Signing in...</span>
                </>
              ) : (
                <>
                  <span>Sign In</span>
                  <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </button>

            {/* Footer */}
            <div className="text-center pt-2">
              <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
                Don't have an account?{" "}
                <a href="#" className="font-semibold transition-colors hover:underline" style={{ color: 'var(--color-primary-500)' }}>
                  Contact your admin
                </a>
              </p>
            </div>
          </form>
        </div>

        {/* Security Badge */}
        <div className="text-center animate-fade-in">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs"
               style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-tertiary)' }}>
            <Shield size={12} />
            <span>Protected by BizTrix Security</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
