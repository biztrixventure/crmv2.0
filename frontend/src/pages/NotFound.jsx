import React from "react";
import { Link } from "react-router-dom";
import { Home, ArrowLeft } from "lucide-react";

const NotFound = () => {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12 relative overflow-hidden"
         style={{ backgroundColor: "var(--color-bg)" }}>
      
      {/* Subtle animated background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 right-1/4 w-64 h-64 rounded-full opacity-10"
             style={{ background: 'radial-gradient(circle, var(--color-primary-400), transparent 70%)', animation: 'pulse 4s ease-in-out infinite' }}></div>
        <div className="absolute bottom-1/4 left-1/3 w-48 h-48 rounded-full opacity-10"
             style={{ background: 'radial-gradient(circle, var(--color-accent), transparent 70%)', animation: 'pulse 5s ease-in-out infinite 1s' }}></div>
      </div>

      <div className="text-center relative z-10 animate-fade-in">
        {/* Animated 404 */}
        <div className="mb-8">
          <h1 className="text-9xl font-black tracking-tight" style={{ color: 'var(--color-primary-200)' }}>
            4<span className="inline-block animate-bounce" style={{ animationDuration: '2s' }}>0</span>4
          </h1>
        </div>

        <h2 className="text-3xl font-bold mb-3" style={{ color: "var(--color-text)" }}>
          Page Not Found
        </h2>

        <p className="text-lg mb-10 max-w-md mx-auto" style={{ color: "var(--color-text-secondary)" }}>
          The page you're looking for doesn't exist or has been moved.
        </p>

        <div className="flex items-center justify-center gap-4">
          <button onClick={() => window.history.back()}
            className="px-6 py-3 rounded-xl font-semibold transition-all duration-300 flex items-center gap-2 hover:scale-105"
            style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)', boxShadow: 'var(--shadow-sm)' }}>
            <ArrowLeft size={18} />
            Go Back
          </button>
          <Link to="/"
            className="px-6 py-3 rounded-xl font-semibold text-white transition-all duration-300 flex items-center gap-2 hover:scale-105"
            style={{ background: 'var(--gradient-sidebar)', boxShadow: 'var(--shadow-md)' }}>
            <Home size={18} />
            Home
          </Link>
        </div>
      </div>
    </div>
  );
};

export default NotFound;
