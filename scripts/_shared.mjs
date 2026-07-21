// Shared helpers for the standalone data scripts.
// Loads .env (no dotenv dependency) and connects mongoose.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import dns from "node:dns";
import mongoose from "mongoose";

// Some local resolvers (VPN clients, corporate DNS, Cloudflare WARP) refuse
// SRV queries, which breaks mongodb+srv:// connections with an ECONNREFUSED
// on the DNS lookup itself, not the DB. Public resolvers always answer them.
dns.setServers(["8.8.8.8", "1.1.1.1"]);

export function loadEnv() {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  try {
    const text = readFileSync(path.join(root, ".env"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // no .env file — rely on real environment (CI)
  }
}

export async function connect() {
  loadEnv();
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI is not set (in .env or environment)");
    process.exit(1);
  }
  await mongoose.connect(uri, { family: 4 });
  return mongoose;
}

const knownIngredientSchema = new mongoose.Schema(
  {
    ingredientName: { type: String, required: true, trim: true, unique: true },
    price: { type: Number, required: true, min: 0 },
    priceUnit: { type: String, required: true, default: "kg" },
    source: { type: String, default: "manual" },
    fetchedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export const KnownIngredients =
  mongoose.models.KnownIngredients ||
  mongoose.model("KnownIngredients", knownIngredientSchema);

export async function upsertPrice({ ingredientName, price, priceUnit, source }) {
  return KnownIngredients.findOneAndUpdate(
    { ingredientName },
    { ingredientName, price, priceUnit, source, fetchedAt: new Date() },
    { new: true, upsert: true }
  );
}
