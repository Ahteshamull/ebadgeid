const mongoose = require("mongoose");
const dns = require('dns');
if (process.env.MONGO_URI && process.env.MONGO_URI.startsWith('mongodb+srv://')) {
  try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch (_) {}
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// AUD-105 + AUD-106 (mismo hallazgo que en backend (updated), ver
// AUDIT_FIXES.md): timeout de conexión sin configurar (hasta ~30s por
// request) y, al corregirlo, un process.exit(1) sin reintento que hacía
// morir el proceso más rápido en vez de tolerar un arranque de Mongo
// unos segundos más lento — un caso real y ordinario dado que
// docker-compose.yml no usa depends_on con condición de salud.
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 1000;

const connectDB = async () => {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      await mongoose.connect(process.env.MONGO_URI, {
        serverSelectionTimeoutMS: 5000,
      });
      console.log(`MongoDB Connected (attempt ${attempt})`);
      return;
    } catch (err) {
      const isLastAttempt = attempt === MAX_RETRIES;
      console.error(`MongoDB connection attempt ${attempt}/${MAX_RETRIES} failed: ${err.message}`);
      if (isLastAttempt) {
        process.exit(1);
      }
      // eslint-disable-next-line no-await-in-loop
      await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
    }
  }
};

module.exports = connectDB;
