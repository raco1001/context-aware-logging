const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");

/**
 * loadEnv - Manually loads environment variables from backend/.env
 * This ensures we use the same configuration as the backend.
 */
function loadEnv() {
  const envPath = path.resolve(__dirname, "../../backend/.env");
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf8");
    envContent.split("\n").forEach((line) => {
      const trimmedLine = line.trim();
      if (trimmedLine && !trimmedLine.startsWith("#")) {
        const [key, ...valueParts] = trimmedLine.split("=");
        if (key && valueParts.length > 0) {
          const value = valueParts.join("=").trim().split(" #")[0].trim(); // Remove inline comments
          process.env[key.trim()] = value;
        }
      }
    });
    console.log(`Loaded environment from ${envPath}`);
  } else {
    console.warn(`Warning: .env file not found at ${envPath}`);
  }
}

loadEnv();

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("Error: MONGODB_URI is not defined in environment variables.");
  process.exit(1);
}

async function run() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db("wide_events");
  const doc = await db
    .collection("wide_events")
    .findOne({ "user.id": "fallback-test-user" });
  console.log(JSON.stringify(doc, null, 2));
  await client.close();
}
run();
