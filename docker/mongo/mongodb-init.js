db = db.getSiblingDB("wide_events");

// Create user for the application
db.createUser({
  user: "eventsAdmin",
  pwd: "eventsAdmin",
  roles: [{ role: "readWrite", db: "wide_events" }],
});

// Create Wide Events collection with Time-series and Validation
db.createCollection("wide_events", {
  timeseries: {
    timeField: "timestamp",
    metaField: "service",
    granularity: "seconds",
  },
});

// Phase 2 Index Strategy
// Phase 2 & 4 Index Strategy for Wide Events (Time-series)
db.wide_events.createIndexes([
  { key: { requestId: 1 }, name: "requestId_index" },
  { key: { timestamp: 1 }, name: "timestamp_index" },
  { key: { service: 1 }, name: "service_index" },

  {
    key: { service: 1, timestamp: -1 },
    name: "service_timestamp_desc_index",
  },
  {
    key: { service: 1, "error.code": 1, timestamp: -1 },
    name: "service_error_code_timestamp_desc_index",
  },
  {
    key: { service: 1, "user.id": 1, timestamp: -1 },
    name: "service_user_id_timestamp_desc_index",
  },
]);

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
db.createCollection("embedding_progress", {
  validator: {
    $jsonSchema: {
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
    },
  },
});

// Embedded Results Collection
db.createCollection("wide_events_embedded", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["eventId", "summary", "model", "embedding", "createdAt"],
      properties: {
        eventId: {
          bsonType: "objectId",
          description: "WideEvent eventId (ObjectID)",
        },
        requestId: {
          bsonType: "string",
          description:
            "Request ID for grounding - links back to original wide_events",
        },
        summary: {
          bsonType: "string",
          description:
            "Dual-layer summary (narrative + canonical) of the WideEvent",
        },
        model: {
          bsonType: "string",
          description: "Model used to embed the WideEvent",
        },
        embedding: {
          bsonType: "array",
          description: "Embedding of the WideEvent",
          items: {
            bsonType: "number",
            description: "Embedding element",
          },
        },
        service: {
          bsonType: "string",
          description: "Service name for filtering",
        },
        timestamp: {
          bsonType: "date",
          description: "Original event timestamp from wide_events",
        },
        createdAt: {
          bsonType: "date",
          description:
            "Timestamp of the WideEvent embedding creation (ISO string)",
        },
      },
    },
  },
});

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
        {
          type: "filter",
          path: "eventId",
        },
        {
          type: "filter",
          path: "timestamp",
          description: "Original event timestamp for time-based filtering",
        },
        {
          type: "filter",
          path: "createdAt",
          description: "Embedding creation timestamp",
        },
        {
          type: "filter",
          path: "service",
        },
      ],
    },
  },
]);

// Phase 4 Strategy
// Create Chat History Collection
db.createCollection("chat_history", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: [
        "sessionId",
        "intent",
        "source",
        "question",
        "answer",
        "confidence",
        "createdAt",
        "updatedAt",
      ],
      properties: {
        sessionId: {
          bsonType: "string",
          description: "Session ID for the chat history",
        },
        intent: {
          bsonType: "string",
          description: "Intent of the question",
        },
        question: {
          bsonType: "string",
          description: "Question asked by the user",
        },
        answer: {
          bsonType: "string",
          description: "Answer generated by the system",
        },
        confidence: {
          bsonType: "number",
          description: "Confidence score of the answer",
        },
        createdAt: {
          bsonType: "date",
          description: "Timestamp of the chat history creation (ISO string)",
        },
        updatedAt: {
          bsonType: "date",
          description: "Timestamp of the chat history update (ISO string)",
        },
        sources: {
          bsonType: "array",
          description: "Sources of the answer",
          items: {
            bsonType: "string",
            description: "Source of the answer",
          },
        },
      },
    },
  },
});

// 1. Optimize for session-based chat history retrieval
db.chat_history.createIndex({ sessionId: 1, createdAt: 1 });

// 2. For performance analysis
db.chat_history.createIndex({ intent: 1, confidence: -1 });
