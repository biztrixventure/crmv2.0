import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";
import { getRoleRoute } from "../utils/roleRouting";
import { Moon, Sun } from "lucide-react";
import { Button, Card, Alert, FormField } from "../components/UI";
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
      // Call backend login endpoint
      const response = await client.post("auth/login", { email, password });

      if (response.data.token && response.data.user) {
        // Use the AuthContext login function to properly store data
        login(response.data.user, response.data.token);

        // Redirect to appropriate dashboard based on user role
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
    <div className="min-h-screen bg-gradient-warm flex flex-col items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
      {/* Theme Toggle Button */}
      <Button
        variant="ghost"
        size="md"
        onClick={toggleTheme}
        className="absolute top-6 right-6"
        title="Toggle dark mode"
        aria-label="Toggle dark mode"
      >
        {theme === "light" ? <Moon size={24} /> : <Sun size={24} />}
      </Button>

      <div className="w-full max-w-md space-y-8">
        {/* Header */}
        <div className="text-center">
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 bg-gradient-sidebar rounded-lg flex items-center justify-center shadow-lg">
              <span className="text-3xl font-bold text-white">B</span>
            </div>
          </div>
          <h1 className="text-4xl font-bold mb-2">BizTrix</h1>
          <p className="text-lg text-primary-500">Customer Relationship Management</p>
          <p className="mt-4 text-sm text-primary-600">
            Sign in to your account to continue
          </p>
        </div>

        {/* Login Form Card */}
        <Card className="p-8">
          <form onSubmit={handleLogin} className="space-y-6">
            {/* Error Alert */}
            {error && (
              <Alert
                type="error"
                title="Sign in failed"
                message={error}
                dismissible={true}
                onDismiss={() => setError("")}
              />
            )}

            {/* Email Field */}
            <FormField
              label="Email Address"
              required
              error={email && !email.includes("@") ? "Invalid email" : ""}
            >
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input"
                placeholder="you@example.com"
              />
            </FormField>

            {/* Password Field */}
            <FormField
              label="Password"
              required
              hint="At least 6 characters"
            >
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input"
                placeholder="••••••••"
              />
            </FormField>

            {/* Submit Button */}
            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={loading}
              disabled={loading}
              className="w-full font-semibold"
            >
              {loading ? "Signing in..." : "Sign In"}
            </Button>

            {/* Support Link */}
            <div className="text-center text-sm text-primary-600">
              <p>
                Don't have an account?{" "}
                <a href="#" className="link font-semibold">
                  Contact support
                </a>
              </p>
            </div>
          </form>
        </Card>

        {/* Footer */}
        <p className="text-center text-xs text-primary-500">
          Protected by BizTrix Security
        </p>
      </div>
    </div>
  );
};

export default Login;

