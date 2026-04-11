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

# Build the React app
# Vite will use VITE_* environment variables set by Coolify at build time
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
