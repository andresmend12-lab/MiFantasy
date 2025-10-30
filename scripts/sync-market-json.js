const fs = require("fs/promises");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const defaultSource = path.join(repoRoot, "market.json");
const defaultDestination = path.join(repoRoot, "frontend", "public", "market.json");

async function ensureFileExists(filePath) {
  try {
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) {
      throw new Error(`No es un archivo: ${filePath}`);
    }
  } catch (error) {
    if (error && error.code === "ENOENT") {
      const relative = path.relative(repoRoot, filePath);
      throw new Error(`No se encontró el archivo ${relative}`);
    }
    throw error;
  }
}

async function syncMarketJson(options = {}) {
  const { source = defaultSource, destination = defaultDestination, quiet = false } = options;
  await ensureFileExists(source);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(source, destination);
  if (!quiet) {
    const relativeSource = path.relative(repoRoot, source);
    const relativeDestination = path.relative(repoRoot, destination);
    console.log(`[sync-market-json] Copiado ${relativeSource} -> ${relativeDestination}`);
  }
  return { source, destination };
}

module.exports = { syncMarketJson };

if (require.main === module) {
  syncMarketJson().catch((error) => {
    console.error(`[sync-market-json] ${error.message}`);
    if (error && error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  });
}
