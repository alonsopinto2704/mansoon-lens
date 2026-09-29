FROM node:24-alpine
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN npm install -g pnpm@11 && pnpm install --frozen-lockfile
COPY . .
RUN sed -i 's#http://localhost:5000#http://api:5000#' vite.config.js
EXPOSE 5173
CMD ["pnpm", "dev", "--host", "0.0.0.0"]
