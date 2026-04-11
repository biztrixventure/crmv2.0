import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "../api/client";
import { useTheme } from "../contexts/ThemeContext";

const Login = () => {
  const navigate = useNavigate();
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
      // Call backend login endpoint
      const response = await axios.post("/auth/login", { email, password });

      if (response.data.token && response.data.user) {
        // Store token and user data
        localStorage.setItem("token", response.data.token);
        localStorage.setItem("user", JSON.stringify(response.data.user));

        // Redirect to dashboard
        navigate("/dashboard");
      }
    } catch (err) {
      setError(err.response?.data?.error || "Login failed. Please try again.");
      console.error("Login error:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-warm flex flex-col items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
      {/* Theme Toggle Button */}
      <button
        onClick={toggleTheme}
        className="absolute top-6 right-6 p-2 rounded-lg btn-secondary"
        title="Toggle dark mode"
      >
        {theme === "light" ? "🌙" : "☀️"}
      </button>

      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 bg-gradient-sidebar rounded-lg flex items-center justify-center shadow-lg">
              <span className="text-3xl font-bold text-white">B</span>
            </div>
          </div>
          <h1 className="text-4xl font-bold mb-2" style={{ color: "var(--color-text)" }}>
            BizTrix
          </h1>
          <p className="text-lg" style={{ color: "var(--color-primary-500)" }}>
            Customer Relationship Management
          </p>
          <p className="mt-4 text-sm" style={{ color: "var(--color-primary-600)" }}>
            Sign in to your account to continue
          </p>
        </div>

        <form className="mt-8 space-y-6 card p-8" onSubmit={handleLogin}>
          {error && (
            <div className="alert alert-error">
              <div className="flex">
                <div>
                  <p className="font-semibold">Error</p>
                  <p>{error}</p>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium mb-2">
                Email Address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input w-full"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium mb-2">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input w-full"
                placeholder="••••••••"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full btn-primary font-semibold py-3"
          >
            {loading ? (
              <span className="flex items-center justify-center">
                <span className="spinner mr-2" style={{ borderWidth: "2px", width: "16px", height: "16px" }}></span>
                Signing in...
              </span>
            ) : (
              "Sign In"
            )}
          </button>

          <div className="text-center text-sm">
            <p style={{ color: "var(--color-primary-600)" }}>
              Don't have an account?{" "}
              <a href="#" className="link font-semibold">
                Contact support
              </a>
            </p>
          </div>
        </form>

        <p className="text-center text-xs" style={{ color: "var(--color-primary-500)" }}>
          Protected by BizTrix Security
        </p>
      </div>
    </div>
  );
};

export default Login;

