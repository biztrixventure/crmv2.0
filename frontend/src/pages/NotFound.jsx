import React from "react";
import { Link } from "react-router-dom";

const NotFound = () => {
  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 py-12"
      style={{ backgroundColor: "var(--color-bg)", backgroundImage: "var(--gradient-warm)" }}
    >
      <div className="text-center">
        <div className="inline-block mb-6">
          <div className="w-24 h-24 bg-gradient-sidebar rounded-lg flex items-center justify-center mx-auto mb-4">
            <span className="text-5xl">🔍</span>
          </div>
        </div>

        <h1 className="text-6xl font-bold mb-4" style={{ color: "var(--color-primary-600)" }}>
          404
        </h1>

        <h2 className="text-3xl font-bold mb-4" style={{ color: "var(--color-text)" }}>
          Page Not Found
        </h2>

        <p className="text-lg mb-8" style={{ color: "var(--color-primary-600)" }}>
          Sorry, the page you're looking for doesn't exist or has been moved.
        </p>

        <Link
          to="/"
          className="inline-block px-8 py-4 rounded-lg font-semibold transition-all smooth-transition"
          style={{
            backgroundColor: "var(--color-primary-600)",
            color: "white",
          }}
          onMouseEnter={(e) => {
            e.target.style.backgroundColor = "var(--color-primary-700)";
            e.target.style.boxShadow = "0 10px 20px rgba(0,0,0,0.1)";
          }}
          onMouseLeave={(e) => {
            e.target.style.backgroundColor = "var(--color-primary-600)";
            e.target.style.boxShadow = "none";
          }}
        >
          🏠 Back to Home
        </Link>
      </div>
    </div>
  );
};

export default NotFound;

