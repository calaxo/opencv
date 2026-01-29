# Utilise l'image Node.js officielle comme base
FROM node:22-alpine AS base

# ===========================================
# Étape 1: Build du frontend avec Vite
# ===========================================
FROM base AS frontend-builder
WORKDIR /app/frontend

# Copie les fichiers de dépendances du frontend
COPY people-counter/package.json people-counter/package-lock.json* ./

# Installe les dépendances du frontend
RUN npm ci

# Copie le code source du frontend
COPY people-counter/ .

# Build du frontend avec Vite
RUN npm run build

# ===========================================
# Étape 2: Préparation du backend
# ===========================================
FROM base AS backend-deps
WORKDIR /app

# Copie les fichiers de dépendances du backend
COPY BACK/package.json BACK/package-lock.json* ./

# Installe les dépendances du backend (production seulement)
RUN npm ci --only=production

# ===========================================
# Étape 3: Image de production
# ===========================================
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

# Crée un utilisateur non-root pour la sécurité
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 appuser

# Copie les dépendances du backend
COPY --from=backend-deps /app/node_modules ./node_modules

# Copie le code du backend
COPY BACK/ .

# Copie le build du frontend dans le dossier assets du backend
COPY --from=frontend-builder /app/frontend/dist ./assets

# Change le propriétaire des fichiers
RUN chown -R appuser:nodejs /app

USER appuser

# Port exposé par le backend
EXPOSE 5500

ENV PORT=5500
ENV HOSTNAME="0.0.0.0"

# Lance le serveur Node.js
CMD ["npm", "start"]