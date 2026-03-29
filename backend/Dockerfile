FROM node:22-alpine

# Set working directory to project root
WORKDIR /app

# Install Python and build dependencies
# Need git for python packages pulled from git, and gcc/g++ if some packages need compiling
RUN apk add --no-cache python3 py3-pip git gcc musl-dev python3-dev linux-headers \
    && rm -rf /var/cache/apk/*

# Copy the entire workspace (root context)
# Note: Ensure .dockerignore exclusions are correct to skip node_modules/.venv
COPY . .

# 1. Install OpenClaw Python dependency globally so 'openclaw' command works inside container
# Use --break-system-packages in Alpine 3.19+ to install system-wide, 
# or use a venv internally. Being a container, --break-system-packages is faster/simpler.
# We also include pip wheel/setuptools update to ensure smooth installs
RUN python3 -m pip install --no-cache-dir --upgrade pip setuptools wheel --break-system-packages \
    && python3 -m pip install --no-cache-dir -e ".[dev]" --break-system-packages

# 2. Build Backend Typescript
# Switch to backend directory for npm operations
WORKDIR /app/backend

# Install node modules
RUN npm ci

# Build the typescript files
RUN npm run build

# Set environment defaults
ENV PORT=8000
ENV NODE_ENV=production

# Expose backend API port
EXPOSE 8000

# Start backend using Production script (compiled output)
# We can just use the start script from package.json
CMD ["npm", "start"]
