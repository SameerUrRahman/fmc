// Local fallback database for development when Atlas is unreachable.
// Starts a mongod on a fixed port with data persisted under .localdb/.
//
//   node scripts/local_db.mjs        (leave running in its own terminal)
//
// Then point the app at it in .env.local:
//   MONGODB_URI=mongodb://
// (Next.js gives .env.local priority over .env, and .env*.local is gitignored.)
import { MongoMemoryServer } from "mongodb-memory-server";
import { mkdirSync } from "node:fs";

const DB_PATH = new URL("../.localdb", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");
mkdirSync(DB_PATH, { recursive: true });

const mongod = await MongoMemoryServer.create({
  instance: { port: 27777, dbPath: DB_PATH, storageEngine: "wiredTiger" },
});

console.log(`Local MongoDB running at ${mongod.getUri()}`);
console.log(`Data persists in ${DB_PATH}`);
console.log("Press Ctrl+C to stop.");

process.on("SIGINT", async () => {
  await mongod.stop();
  process.exit(0);
});
