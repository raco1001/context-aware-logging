db = db.getSiblingDB("wide_events");

function collectionExists(name) {
  return db.getCollectionNames().indexOf(name) !== -1;
}

function ensureUser(user, pwd, roles) {
  let exists = false;

  try {
    const existing = db.getUser(user);
    exists = !!existing;
  } catch (e) {
    // Some environments/drivers may not support db.getUser reliably for non-admin DBs.
    print(`[init] db.getUser check failed for ${user}: ${e}`);
  }

  if (!exists) {
    try {
      const info = db.runCommand({ usersInfo: user });
      const users = info && info.users ? info.users : [];
      exists = Array.isArray(users) && users.length > 0;
    } catch (e) {
      print(`[init] usersInfo check failed for ${user}: ${e}`);
    }
  }

  if (exists) {
    print(`[init] user already exists: ${user}`);
    return;
  }

  print(`[init] creating user: ${user}`);
  try {
    db.createUser({ user, pwd, roles });
  } catch (e) {
    // Make idempotent even if existence checks are flaky.
    const msg = (e && e.message) ? e.message : String(e);
    if (msg.indexOf("already exists") !== -1) {
      print(`[init] user already exists (createUser raced): ${user}`);
      return;
    }
    throw e;
  }
}

function ensureCollection(name, options) {
  if (collectionExists(name)) {
    print(`[init] collection already exists: ${name}`);
    return;
  }

  print(`[init] creating collection: ${name}`);
  db.createCollection(name, options || {});
}

function ensureValidator(name, jsonSchema) {
  // Always force validator on existing collections to avoid schema drift across runs.
  if (!collectionExists(name)) {
    throw new Error(
      `[init] cannot apply validator: collection does not exist (${name})`,
    );
  }

  try {
    db.runCommand({
      collMod: name,
      validator: { $jsonSchema: jsonSchema },
      validationLevel: "moderate",
    });
    print(`[init] validator applied via collMod: ${name}`);
  } catch (e) {
    print(`[init] validator collMod failed for ${name}: ${e}`);
    throw e;
  }
}

function ensureSearchIndexEmbeddedEmbeddingIndex() {
  // Atlas Search APIs can be unavailable depending on environment/permissions.
  // Keep this idempotent: create only if missing; otherwise skip.
  try {
    if (typeof db.wide_events_embedded.getSearchIndexes !== "function") {
      // If we can't check existence, still attempt create (and swallow failures) to keep init robust.
      print("[init] getSearchIndexes() not available; will attempt createSearchIndexes");
    } else {
      const indexes = db.wide_events_embedded.getSearchIndexes();
      const exists = Array.isArray(indexes)
        ? indexes.some((idx) => idx && idx.name === "embedding_index")
        : false;

      if (exists) {
        print("[init] search index already exists: embedding_index");
        return;
      }
    }
  } catch (e) {
    print(`[init] search index existence check failed; will attempt create: ${e}`);
  }

  try {
    db.wide_events_embedded.createSearchIndexes([
      {
        name: "embedding_index",
        type: "vectorSearch",
        definition: {
          fields: [
            {
              type: "vector",
              path: "embedding",
              numDimensions: 512,
              similarity: "cosine",
            },
            { type: "filter", path: "eventId" },
            {
              type: "filter",
              path: "timestamp",
            },
            {
              type: "filter",
              path: "createdAt",
            },
            { type: "filter", path: "service" },
            { type: "filter", path: "route" },
            { type: "filter", path: "hasError" },
            { type: "filter", path: "errorCode" },
            { type: "filter", path: "outcome" },
            { type: "filter", path: "failedAt" },
          ],
        },
      },
    ]);
    print("[init] search index created: embedding_index");
  } catch (e) {
    print(`[init] search index create failed: ${e}`);
  }
}

// Create user for the application (idempotent)
ensureUser("eventsAdmin", "eventsAdmin", [
  { role: "readWrite", db: "wide_events" },
]);

// Wide Events collection (time-series). If it already exists, we don't attempt to
// modify time-series options here; use volume reset for structural changes.
ensureCollection("wide_events", {
  timeseries: {
    timeField: "timestamp",
    metaField: "service",
    granularity: "seconds",
  },
});

// Phase 2 Index Strategy
// Phase 2 & 4 Index Strategy for Wide Events (Time-series)
// NOTE: createIndexes([...]) can behave inconsistently across shell/runtime combos for time-series.
// Use createIndex() calls for stable, repeatable init runs.
db.wide_events.createIndex({ requestId: 1 }, { name: "requestId_index" });
db.wide_events.createIndex({ timestamp: 1 }, { name: "timestamp_index" });
db.wide_events.createIndex({ service: 1 }, { name: "service_index" });
db.wide_events.createIndex(
  { service: 1, timestamp: -1 },
  { name: "service_timestamp_desc_index" },
);
db.wide_events.createIndex(
  { service: 1, "error.code": 1, timestamp: -1 },
  { name: "service_error_code_timestamp_desc_index" },
);
db.wide_events.createIndex(
  { service: 1, "user.id": 1, timestamp: -1 },
  { name: "service_user_id_timestamp_desc_index" },
);

db.wide_events.createIndex(
  { requestId: 1, timestamp: -1 },
  {
    name: "request_timestamp_desc_index",
    partialFilterExpression: { requestId: { $exists: true } },
  },
);

// Phase 3 Strategy
// Create High Water Mark Collection
// For Tracking Embedding Progress
const embeddingProgressSchema = {
  bsonType: "object",
  required: [
    "source",
    "lastEmbeddedEventId",
    "lastEmbeddedEventTimestamp",
    "lastUpdatedAt",
  ],
  properties: {
    source: {
      bsonType: "string",
      description: "Source collection name (e.g. wide_events)",
    },
    lastEmbeddedEventId: {
      bsonType: "objectId",
      description: "Last embedded WideEvent _id (ObjectID)",
    },
    lastEmbeddedEventTimestamp: {
      bsonType: "date",
      description: "Timestamp of the last embedded WideEvent (ISO string)",
    },
    lastUpdatedAt: {
      bsonType: "date",
      description: "Timestamp of the last update (ISO string)",
    },
  },
};

ensureCollection("embedding_progress", {
  validator: { $jsonSchema: embeddingProgressSchema },
});
ensureValidator("embedding_progress", embeddingProgressSchema);

// Embedded Results Collection
const wideEventsEmbeddedSchema = {
  bsonType: "object",
  required: ["eventId", "summary", "model", "embedding", "createdAt"],
  properties: {
    eventId: {
      bsonType: "objectId",
      description: "WideEvent eventId (ObjectID)",
    },
    requestId: {
      bsonType: "string",
      description: "Request ID for grounding - links back to original wide_events",
    },
    summary: {
      bsonType: "string",
      description: "Dual-layer summary (narrative + canonical) of the WideEvent",
    },
    model: {
      bsonType: "string",
      description: "Model used to embed the WideEvent",
    },
    embedding: {
      bsonType: "array",
      description: "Embedding of the WideEvent",
      items: { bsonType: "number", description: "Embedding element" },
    },
    service: { bsonType: ["string", "null"], description: "Service name for filtering" },
    timestamp: {
      bsonType: ["date", "null"],
      description: "Original event timestamp from wide_events",
    },
    route: { bsonType: ["string", "null"], description: "Canonical route for filtering" },
    hasError: { bsonType: ["bool", "null"], description: "Whether the source event has an error" },
    errorCode: { bsonType: ["string", "null"], description: "Error code for filtering (if any)" },
    outcome: { bsonType: ["string", "null"], description: "Derived outcome of the WideEvent" },
    failedAt: { bsonType: ["string", "null"], description: "Multi-step failure stage (Pattern A)" },
    createdAt: {
      bsonType: "date",
      description: "Timestamp of the WideEvent embedding creation (ISO string)",
    },
  },
};

ensureCollection("wide_events_embedded", {
  validator: { $jsonSchema: wideEventsEmbeddedSchema },
});
ensureValidator("wide_events_embedded", wideEventsEmbeddedSchema);

ensureSearchIndexEmbeddedEmbeddingIndex();

// Phase 4 Strategy
// Create Chat History Collection
const chatHistorySchema = {
  bsonType: "object",
  required: [
    "sessionId",
    "intent",
    "sources",
    "question",
    "answer",
    "confidence",
    "createdAt",
    "updatedAt",
  ],
  properties: {
    sessionId: { bsonType: "string", description: "Session ID for the chat history" },
    clientId: { bsonType: "string", description: "Anonymous client id (X-Client-Id)" },
    intent: { bsonType: "string", description: "Intent of the question" },
    question: { bsonType: "string", description: "Question asked by the user" },
    title: { bsonType: "string", description: "Session title (first question excerpt)" },
    answer: { bsonType: "string", description: "Answer generated by the system" },
    confidence: { bsonType: "number", description: "Confidence score of the answer" },
    createdAt: { bsonType: "date", description: "Timestamp of the chat history creation (ISO string)" },
    updatedAt: { bsonType: "date", description: "Timestamp of the chat history update (ISO string)" },
    sources: {
      bsonType: "array",
      description: "Sources of the answer",
      items: { bsonType: "object", description: "Source of the answer" },
    },
  },
};

ensureCollection("chat_history", { validator: { $jsonSchema: chatHistorySchema } });
ensureValidator("chat_history", chatHistorySchema);

// 1. Optimize for session-based chat history retrieval
db.chat_history.createIndex({ sessionId: 1, createdAt: 1 });

// 1b. Client-scoped session listing (Phase 5.2)
db.chat_history.createIndex({ clientId: 1 }, { name: "chat_history_clientId_index" });

// 2. For performance analysis
db.chat_history.createIndex({ intent: 1, confidence: -1 });
