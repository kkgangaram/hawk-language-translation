FROM node:16-slim

WORKDIR /app

COPY package.json .npmrc tsconfig.json ./
RUN npm install -g typescript ts-node
RUN npm install --unsafe-perm

COPY . .

# RUN npm run build

ENV NODE_ENV=production
ENV SERVERPORT=8080
ENV SERVERHOST=0.0.0.0
EXPOSE 8080

CMD ["npx", "ts-node", "--transpile-only", "src/index.ts"]
