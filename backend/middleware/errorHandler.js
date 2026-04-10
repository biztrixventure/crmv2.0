// Global error handling middleware
export const errorHandler = (err, req, res, next) => {
  console.error("Error:", {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  // Supabase errors
  if (err.message?.includes("Supabase") || err.status) {
    return res.status(err.status || 500).json({
      error: err.message,
      code: err.code,
    });
  }

  // Validation errors
  if (err.array) {
    return res.status(400).json({
      error: "Validation failed",
      details: err.array(),
    });
  }

  // Default error
  res.status(500).json({
    error: "Internal server error",
    message: process.env.NODE_ENV === "development" ? err.message : "Something went wrong",
  });
};

// Async error wrapper
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
