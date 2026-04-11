import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { errorHandler } from "./middleware/errorHandler.js";
import { authMiddleware } from "./middleware/authMiddleware.js";

// Import routes
import authRoutes from "./routes/auth.js";

// Load environment variables
dotenv.config({ path: ".env.local" });

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || "http://localhost:5173",
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Health check (no auth required)
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ============================================================================
// Public Routes (no auth required)
// ============================================================================
app.use("/auth", authRoutes);

// ============================================================================
// Protected Routes (auth required)
// ============================================================================
// Uncomment when adding protected routes
// app.use("/api", authMiddleware);
// app.use("/api/users", require("./routes/users.js"));
// app.use("/api/companies", require("./routes/companies.js"));
// app.use("/api/transfers", require("./routes/transfers.js"));
// app.use("/api/sales", require("./routes/sales.js"));

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Route not found", path: req.path });
});

// Error handling middleware (must be last)
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Backend server running on http://localhost:${PORT}`);
  console.log(`📡 Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`🔗 Supabase URL: ${process.env.VITE_SUPABASE_URL}`);
  console.log(`🌐 CORS Origin: ${process.env.CORS_ORIGIN || "http://localhost:5173"}`);
});

export default app;
