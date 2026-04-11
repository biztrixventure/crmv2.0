# Build stage
FROM node:18-alpine as builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies - make sure devDependencies are included for build
# Override NODE_ENV to ensure all dependencies are installed
ENV NODE_ENV=development
RUN npm install

# Copy source code
COPY . .

# Runtime stage
FROM node:18-alpine

WORKDIR /app

# Install curl for health checks
RUN apk add --no-cache curl

# Copy package files
COPY package*.json ./

# Install production dependencies only
# Set NODE_ENV before install to skip devDependencies
ENV NODE_ENV=production
RUN npm install --production

# Copy application from builder
COPY --from=builder /app .

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1

# Start the application
CMD ["npm", "start"]
