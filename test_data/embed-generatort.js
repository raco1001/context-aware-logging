const fs = require("fs");
const path = require("path");
const http = require("http");
const { MongoClient } = require("mongodb");

// 1. Read .env from backend directory
const envPath = path.join(__dirname, "../backend/.env");
let MONGODB_URI = "";
let PORT = 3000;

if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  const mongoUriMatch = envContent.match(/^MONGODB_URI=(.+)$/m);
  const portMatch = envContent.match(/^PORT=(\d+)$/m);

  if (mongoUriMatch) MONGODB_URI = mongoUriMatch[1].trim();
  if (portMatch) PORT = parseInt(portMatch[1].trim(), 10);
}

// Fallback or explicit override if needed
MONGODB_URI = MONGODB_URI || "mongodb://localhost:27017/wide_events";

async function run() {
  console.log("--- Embedding Test Tool ---");
  console.log(`Target Backend: http://localhost:${PORT}`);
  console.log(`MongoDB URI: ${MONGODB_URI.replace(/:([^@]+)@/, ":****@")}`); // Mask password

  let client;
  try {
    // 2. Check MongoDB Status
    console.log("\n[1/3] Checking MongoDB data status...");
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    const db = client.db();

    const logsCollection = db.collection("wide_events");
    const embeddedCollection = db.collection("wide_events_embedded");
    const progressCollection = db.collection("embedding_progress");

    const totalLogs = await logsCollection.countDocuments();
    const embeddedLogs = await embeddedCollection.countDocuments();
    const progress = await progressCollection.findOne({
      source: "wide_events",
    });

    console.log(`- Total logs in 'wide_events': ${totalLogs}`);
    console.log(`- Embedded logs in 'wide_events_embedded': ${embeddedLogs}`);
    console.log(`- Pending logs: ${totalLogs - embeddedLogs}`);
    if (progress) {
      console.log(
        `- Last watermark: ${progress.lastEmbeddedEventTimestamp} (${progress.lastEmbeddedEventId})`,
      );
    }

    // 3. Trigger Batch Embedding
    console.log(`\n[2/3] Triggering batch embedding request...`);
    const limit = process.argv[2] || 50;

    const requestOptions = {
      hostname: "localhost",
      port: PORT,
      path: `/embeddings/batch?limit=${limit}`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    };

    const response = await new Promise((resolve, reject) => {
      const req = http.request(requestOptions, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () =>
          resolve({
            statusCode: res.statusCode,
            body: JSON.parse(data),
          }),
        );
      });
      req.on("error", (err) => reject(envPath));
      req.end();
    });

    console.log(`- Status: ${response.statusCode}`);
    console.log(`- Response: ${JSON.stringify(response.body, null, 2)}`);

    // 4. Verify after request
    console.log("\n[3/3] Verifying update...");
    const newEmbeddedLogs = await embeddedCollection.countDocuments();
    console.log(
      `- New total embedded logs: ${newEmbeddedLogs} (+${newEmbeddedLogs - embeddedLogs})`,
    );
  } catch (error) {
    console.error("\n[ERROR]", error.message);
    if (error.message.includes("ECONNREFUSED")) {
      console.error("Make sure the backend server is running on port " + PORT);
    }
  } finally {
    if (client) await client.close();
    console.log("\n--- Done ---");
  }
}

run();
