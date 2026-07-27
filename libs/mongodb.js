import dns from "node:dns";
import dnsPromises from "node:dns/promises";
import mongoose from "mongoose";

// Some local resolvers (VPN clients, corporate DNS, Cloudflare WARP) refuse
// SRV queries, which breaks mongodb+srv:// connections with an ECONNREFUSED
// on the DNS lookup itself, not the DB. Public resolvers always answer them.
//
// Both APIs must be set. Node binds the callback and promise DNS APIs to the
// default resolver when each is first loaded, and `dns.setServers()` only
// reliably rebinds the callback side — whether `dns.promises` picks it up
// depends on load order, and under Next/Turbopack it loses that race and keeps
// the system resolver. The mongodb driver resolves SRV with
// `dns.promises.resolve(host, "SRV")`, i.e. the one resolver the override was
// missing, so pages 500d with ECONNREFUSED while `dns.getServers()` reported
// 8.8.8.8.
const DNS_SERVERS = ["8.8.8.8", "1.1.1.1"];
dns.setServers(DNS_SERVERS);
dnsPromises.setServers(DNS_SERVERS); // the one the driver actually reads

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  throw new Error('Please define the MONGODB_URI environment variable inside .env');
}

/**
 * Global is used here to maintain a cached connection across hot reloads
 * in development. This prevents connections growing exponentially
 * during API Route usage.
 */
let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

async function connectMongoDB() {
  if (cached.conn) {
    console.log("Using existing MongoDB connection");
    return cached.conn;
  }

  if (!cached.promise) {
    const opts = {
      bufferCommands: false,
      family: 4, // Force IPv4 to avoid Node 17+ DNS issues
    };

    console.log("----------------------------------------");
    console.log("Creating NEW MongoDB connection...");
    console.log("----------------------------------------");

    cached.promise = mongoose.connect(MONGODB_URI, opts).then((mongoose) => {
      console.log("Connected Successfully (New Connection)");
      return mongoose;
    });
  }

  try {
    cached.conn = await cached.promise;
  } catch (e) {
    cached.promise = null;
    throw e;
  }

  return cached.conn;
}

export default connectMongoDB;