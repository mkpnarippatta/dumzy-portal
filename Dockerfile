FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --only=production

FROM node:20-alpine
WORKDIR /app
RUN addgroup --system app && adduser --system --ingroup app app
COPY --from=build /app/node_modules ./node_modules
COPY src/ ./src/
COPY .env.example .env
USER app
EXPOSE 3099
ENV PORT=3099 NODE_ENV=production
CMD ["node", "src/gateway.js"]
