# Backend Dockerfile
FROM node:16

WORKDIR /app

# Copy package.json dan package-lock.json untuk install dependencies
COPY package*.json ./
RUN npm install

# Copy seluruh kode backend
COPY . .

# Expose port untuk API
EXPOSE 5000

# Jalankan aplikasi
CMD ["node", "server.js"]
