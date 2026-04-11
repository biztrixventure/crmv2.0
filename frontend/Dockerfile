# Build stage
FROM node:18-alpine as builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# CRITICAL: Unset NODE_ENV completely before npm install
# This ensures ALL dependencies (devDependencies included) are installed
RUN unset NODE_ENV && npm install --legacy-peer-deps

# Copy entire source including all files needed for build
COPY . .

# Create .env.local for build with required variables
ENV VITE_SUPABASE_URL=https://placeholder.supabase.co
ENV VITE_SUPABASE_ANON_KEY=placeholder
ENV VITE_API_URL=http://localhost:3001

# Build the React app with verbose output
RUN npm run build --verbose

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
