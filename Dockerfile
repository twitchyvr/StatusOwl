# StatusOwl Dockerfile

# ============================================
# Builder Stage
# ============================================
FROM node:20 AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source and build
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ============================================
# Production Stage
# ============================================
FROM node:20-slim

WORKDIR /app

# Copy package files for production dependencies
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy built artifacts from builder
COPY --from=builder /app/dist ./dist

# Copy static status page files
COPY src/status-page/ ./dist/status-page/

# Expose port
EXPOSE 3000

# Start the server
CMD ["node", "dist/server.js"]
