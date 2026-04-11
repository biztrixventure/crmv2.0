# Build stage
FROM node:18-alpine as builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# CRITICAL: Unset NODE_ENV completely before npm install
# This ensures ALL dependencies (devDependencies included) are installed
RUN unset NODE_ENV && npm install --legacy-peer-deps

# Copy entire source
COPY . .

# Vite will use env vars passed at build time via build args or .env
# The following will be set by Coolify:
# - VITE_SUPABASE_URL
# - VITE_SUPABASE_ANON_KEY
# - VITE_API_URL

# Build the React app (Vite reads env vars prefixed with VITE_)
RUN npm run build

# Production stage - Use lightweight nginx for serving static files
FROM nginx:alpine

# Copy nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Copy built files from builder
COPY --from=builder /app/dist /usr/share/nginx/html

# Expose port
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost/ || exit 1

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
