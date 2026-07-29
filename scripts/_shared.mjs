// Shared helpers for the standalone data scripts.
// Loads .env (no dotenv dependency) and connects mongoose.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import dns from "node:dns";
import dnsPromises from "node:dns/promises";
import mongoose from "mongoose";

// Some local resolvers (VPN clients, corporate DNS, Cloudflare WARP) refuse
// SRV queries, which breaks mongodb+srv:// connections with an ECONNREFUSED
// on the DNS lookup itself, not the DB. Public resolvers always answer them.
// Both APIs must be set — the mongodb driver resolves SRV through
// `dns.promises`, which `dns.setServers()` does not reliably rebind. See the
// same comment in libs/mongodb.js.
const DNS_SERVERS = ["8.8.8.8", "1.1.1.1"];
dns.setServers(DNS_SERVERS);
dnsPromises.setServers(DNS_SERVERS);

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

// Mirror of models/PriceSnapshot.js — the scripts are .mjs and can't import
// ESM-in-.js, so the schema lives in two places. Change both together.
const priceSnapshotSchema = new mongoose.Schema(
  {
    ingredientName: { type: String, required: true, trim: true },
    knownIngredientId: { type: mongoose.Schema.Types.ObjectId, ref: "KnownIngredients" },
    price: { type: Number, required: true, min: 0 },
    priceUnit: { type: String, required: true, default: "kg" },
    source: { type: String, required: true, default: "manual" },
    observedOn: { type: String, required: true },
    observedAt: { type: Date, required: true, default: Date.now },
    note: { type: String, default: "", trim: true },
  },
  { timestamps: true }
);
priceSnapshotSchema.index({ ingredientName: 1, source: 1, observedOn: 1 }, { unique: true });
priceSnapshotSchema.index({ ingredientName: 1, observedAt: -1 });

export const PriceSnapshot =
  mongoose.models.PriceSnapshot ||
  mongoose.model("PriceSnapshot", priceSnapshotSchema);

/**
 * The IST calendar day for an instant, as "YYYY-MM-DD".
 * Snapshots bucket by Indian day, not UTC day: the cron fires at 09:00 IST,
 * and a UTC-midnight boundary would put a single Indian day in two buckets
 * (and put the 09:00 IST run of the 1st into the UTC day of the 31st).
 */
export function istDay(date = new Date()) {
  // en-CA formats as YYYY-MM-DD, which is exactly what we want.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * Append one price observation to the log.
 * Idempotent per (ingredient, source, IST day) — re-running a sync on the same
 * day corrects that day's reading instead of duplicating it.
 */
export async function recordSnapshot({
  ingredientName,
  knownIngredientId,
  price,
  priceUnit,
  source,
  observedAt = new Date(),
}) {
  return PriceSnapshot.findOneAndUpdate(
    { ingredientName, source, observedOn: istDay(observedAt) },
    {
      ingredientName,
      knownIngredientId,
      price,
      priceUnit,
      source,
      observedOn: istDay(observedAt),
      observedAt,
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}

/**
 * Update the current price AND append it to the observation log.
 *
 * KnownIngredients is the materialized "what does this cost now" view;
 * PriceSnapshot is the durable history behind it. Every price writer in this
 * repo goes through here, so history is never silently lost.
 */
export async function upsertPrice({ ingredientName, price, priceUnit, source }) {
  const now = new Date();
  const known = await KnownIngredients.findOneAndUpdate(
    { ingredientName },
    { ingredientName, price, priceUnit, source, fetchedAt: now },
    { new: true, upsert: true }
  );
  await recordSnapshot({
    ingredientName,
    knownIngredientId: known?._id,
    price,
    priceUnit,
    source,
    observedAt: now,
  });
  return known;
}
