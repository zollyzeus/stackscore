# ---- build ----
FROM node:20-slim AS build
WORKDIR /app
# Copy the lockfile too, and install from it: the previous `npm install` with only
# package.json ignored package-lock.json entirely, so builds were not reproducible.
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- run ----
FROM node:20-slim AS run
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public

# Candidate-submitted code runs in this process (lib/sandbox.ts); do not run as root.
USER node

EXPOSE 8080
CMD ["node", "server.js"]
