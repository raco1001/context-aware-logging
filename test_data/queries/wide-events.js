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

const dbName = "wide_events";
const collectionName = "wide_events";

async function run() {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    console.log("====================================================");
    console.log("  Wide Event Data Integrity & Sampling Audit");
    console.log("====================================================");

    const db = client.db(dbName);
    const collection = db.collection(collectionName);

    // 1. Total Records in MongoDB
    const totalCount = await collection.countDocuments();
    console.log(`\n1. Total Records Found: ${totalCount}`);

    // 2. Sampling Policy Verification
    // Group by _samplingReason to see if the policy is being applied correctly
    const samplingStats = await collection
      .aggregate([
        { $group: { _id: "$_metadata._sampling.reason", count: { $sum: 1 } } },
      ])
      .toArray();
    console.log("\n2. Sampling Stats (Reason for recording):");
    if (samplingStats.length === 0) {
      console.log(
        "   (No records found or _metadata._sampling.reason missing)",
      );
    } else {
      samplingStats.forEach((stat) => {
        const reason = stat._id || "UNKNOWN";
        console.log(`   - ${reason.padEnd(20)}: ${stat.count} records`);
      });
    }

    // 3. Error Retention (Should be 100% if HAS_ERROR reason works)
    const errorCount = await collection.countDocuments({
      error: { $exists: true, $ne: null },
    });
    console.log(`\n3. Total Error Events: ${errorCount}`);

    // 4. Performance Audit (Slow Requests)
    const threshold = parseInt(process.env.LOG_SLOW_THRESHOLD_MS || "2000", 10);
    const slowCount = await collection.countDocuments({
      "performance.durationMs": { $gt: threshold },
    });
    console.log(`\n4. Slow Requests (> ${threshold}ms): ${slowCount}`);

    // 5. Service & Route Distribution
    // This shows where the logs are coming from (Payments, Search, etc.)
    const distribution = await collection
      .aggregate([
        {
          $group: {
            _id: { service: "$service", route: "$route" },
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
      ])
      .toArray();
    console.log("\n5. Distribution by Service & Route:");
    distribution.forEach((dist) => {
      const serviceName = (dist._id.service || "UNKNOWN").padEnd(15);
      const routePath = (dist._id.route || "UNKNOWN").padEnd(20);
      console.log(`   - ${serviceName} [${routePath}]: ${dist.count}`);
    });

    // 6. Context Metadata Integrity
    // Verify that _metadata (request context) is actually being preserved
    const metadataCount = await collection.countDocuments({
      _metadata: { $exists: true, $ne: null },
    });
    console.log(
      `\n6. Records with Context (_metadata): ${metadataCount} / ${totalCount}`,
    );

    // 7. Recent Log Preview
    const recentSamples = await collection
      .find()
      .sort({ timestamp: -1 })
      .limit(5)
      .toArray();
    console.log("\n7. Recent Log Preview (Last 5):");
    recentSamples.forEach((sample) => {
      const ts =
        sample.timestamp instanceof Date
          ? sample.timestamp.toISOString()
          : sample.timestamp;
      const status = sample.error ? "FAIL" : "OK";
      const reason = sample._metadata?._sampling?.reason || "N/A";
      console.log(
        `   - [${ts}] ${sample.requestId.substring(0, 8)}... | ${sample.service.padEnd(12)} | ${sample.route.padEnd(15)} | ${status.padEnd(4)} | Reason: ${reason}`,
      );
    });

    console.log("\n====================================================");
    console.log("  Audit Complete");
    console.log("====================================================");
  } catch (error) {
    console.error("\nError executing audit queries:", error.message);
  } finally {
    await client.close();
  }
}

run();
