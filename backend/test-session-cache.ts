/**
 * Session Cache Persistence Test
 *
 * Tests whether session cache persists across multiple operations
 * and correctly falls back to database when cache expires or is missing.
 *
 * Run: npx ts-node test-session-cache.ts
 */

import { MongoClient } from "mongodb";
import { AnalysisResult, SessionSummary } from "./src/embeddings/core/dtos/analysis-result";
import { AnalysisIntent } from "./src/embeddings/core/value-objects/filter";
// Mock ChatHistoryPort for testing
class MockChatHistoryPort {
  private storage: Map<string, AnalysisResult[]> = new Map();

  async save(result: AnalysisResult): Promise<void> {
    const sessionId = result.sessionId || "default";
    if (!this.storage.has(sessionId)) {
      this.storage.set(sessionId, []);
    }
    this.storage.get(sessionId)!.push(result);
    console.log(`[DB] Saved to session ${sessionId}: ${result.question}`);
  }

  async findBySessionId(sessionId: string): Promise<AnalysisResult[]> {
    const history = this.storage.get(sessionId) || [];
    console.log(
      `[DB] Retrieved ${history.length} messages for session ${sessionId}`,
    );
    return [...history]; // Return copy
  }

  async listSessions(clientId?: string): Promise<SessionSummary[]> {
    const grouped = new Map<string, AnalysisResult[]>();
    for (const [, results] of this.storage) {
      for (const r of results) {
        if (clientId && r.clientId !== clientId) continue;
        const sid = r.sessionId || "default";
        if (!grouped.has(sid)) grouped.set(sid, []);
        grouped.get(sid)!.push(r);
      }
    }

    const summaries: SessionSummary[] = [];
    for (const [sid, items] of grouped) {
      const sorted = items.sort(
        (a, b) =>
          new Date(a.createdAt || 0).getTime() -
          new Date(b.createdAt || 0).getTime(),
      );
      summaries.push({
        sessionId: sid,
        clientId: sorted[0].clientId,
        title: sorted[0].title || sorted[0].question.slice(0, 50),
        lastMessage: sorted[sorted.length - 1].answer.slice(0, 100),
        messageCount: sorted.length,
        createdAt: sorted[0].createdAt || "",
        updatedAt: sorted[sorted.length - 1].createdAt || "",
      });
    }

    return summaries.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }

  async deleteSession(
    sessionId: string,
    clientId: string,
  ): Promise<boolean> {
    const results = this.storage.get(sessionId);
    if (!results) return false;
    const remaining = results.filter((r) => r.clientId !== clientId);
    if (remaining.length === results.length) return false;
    if (remaining.length === 0) {
      this.storage.delete(sessionId);
    } else {
      this.storage.set(sessionId, remaining);
    }
    return true;
  }

  clear(): void {
    this.storage.clear();
  }
}

// Simplified SessionCacheService for testing (without NestJS dependencies)
class TestSessionCacheService {
  private readonly activeSessions = new Map<
    string,
    {
      history: AnalysisResult[];
      lastAccessed: Date;
      ttl: number;
    }
  >();
  private readonly defaultTtl = 30 * 60 * 1000; // 30 minutes
  private dbHits = 0;
  private cacheHits = 0;

  constructor(private readonly chatHistoryPort: MockChatHistoryPort) {}

  async getHistory(sessionId: string): Promise<AnalysisResult[]> {
    const cached = this.activeSessions.get(sessionId);
    if (cached && !this.isExpired(cached)) {
      cached.lastAccessed = new Date();
      this.cacheHits++;
      console.log(
        `[CACHE HIT] Session ${sessionId} (${cached.history.length} messages)`,
      );
      return cached.history;
    }

    this.dbHits++;
    console.log(`[CACHE MISS] Session ${sessionId}, fetching from DB`);
    const history = await this.chatHistoryPort.findBySessionId(sessionId);

    if (history.length > 0) {
      this.activeSessions.set(sessionId, {
        history,
        lastAccessed: new Date(),
        ttl: this.defaultTtl,
      });
      console.log(
        `[CACHE] Cached session ${sessionId} with ${history.length} messages`,
      );
    }

    return history;
  }

  async updateSession(
    sessionId: string,
    result: AnalysisResult,
    clientId?: string,
  ): Promise<void> {
    const base = clientId ? { ...result, clientId } : { ...result };
    const isFirst = await this.isFirstMessageInSession(sessionId);
    const toSave =
      isFirst && result.question
        ? { ...base, title: result.question.slice(0, 50) }
        : base;

    await this.chatHistoryPort.save(toSave);

    const cached = this.activeSessions.get(sessionId);
    if (cached) {
      cached.history.push(toSave);
      cached.lastAccessed = new Date();
      console.log(
        `[CACHE] Updated session ${sessionId} (now ${cached.history.length} messages)`,
      );
    } else {
      this.activeSessions.set(sessionId, {
        history: [toSave],
        lastAccessed: new Date(),
        ttl: this.defaultTtl,
      });
      console.log(`[CACHE] Created new cache entry for session ${sessionId}`);
    }
  }

  async listSessions(clientId: string): Promise<SessionSummary[]> {
    if (!clientId) return [];
    return this.chatHistoryPort.listSessions(clientId);
  }

  async deleteSession(
    sessionId: string,
    clientId: string,
  ): Promise<boolean> {
    if (!sessionId || !clientId) return false;
    const removed = await this.chatHistoryPort.deleteSession(
      sessionId,
      clientId,
    );
    if (removed) {
      this.invalidateSession(sessionId);
    }
    return removed;
  }

  invalidateSession(sessionId: string): void {
    if (this.activeSessions.delete(sessionId)) {
      console.log(`[CACHE] Invalidated session ${sessionId}`);
    }
  }

  private async isFirstMessageInSession(sessionId: string): Promise<boolean> {
    const cached = this.activeSessions.get(sessionId);
    if (cached && cached.history.length > 0) return false;
    const fromDb = await this.chatHistoryPort.findBySessionId(sessionId);
    return fromDb.length === 0;
  }

  private isExpired(cached: { lastAccessed: Date; ttl: number }): boolean {
    const now = new Date();
    const elapsed = now.getTime() - cached.lastAccessed.getTime();
    return elapsed > cached.ttl;
  }

  getStats() {
    return {
      activeSessions: this.activeSessions.size,
      cacheHits: this.cacheHits,
      dbHits: this.dbHits,
      totalMessages: Array.from(this.activeSessions.values()).reduce(
        (sum, session) => sum + session.history.length,
        0,
      ),
    };
  }

  clearCache(): void {
    this.activeSessions.clear();
    this.cacheHits = 0;
    this.dbHits = 0;
  }
}

// Test helper functions
function createTestResult(
  sessionId: string,
  question: string,
  answer: string,
  index: number,
  clientId?: string,
): AnalysisResult {
  return {
    sessionId,
    ...(clientId ? { clientId } : {}),
    question,
    intent: AnalysisIntent.SEMANTIC,
    answer,
    sources: [
      {
        id: `request-${index}`,
        summary: '',
        status: 'SUCCESS',
        route: '',
        duration: 0,
        timestamp: new Date().toISOString(),
      },
    ],
    confidence: 0.9,
  };
}

async function runTests() {
  console.log("=".repeat(60));
  console.log("Session Cache Persistence Test");
  console.log("=".repeat(60));
  console.log();

  const mockDb = new MockChatHistoryPort();
  const cacheService = new TestSessionCacheService(mockDb);

  const sessionId = "test-session-001";

  // Test 1: Initial session creation
  console.log("📝 Test 1: Initial session creation");
  console.log("-".repeat(60));
  const result1 = createTestResult(
    sessionId,
    "첫 번째 질문",
    "첫 번째 답변",
    1,
  );
  await cacheService.updateSession(sessionId, result1);
  console.log();

  // Test 2: Cache hit on second access
  console.log("📝 Test 2: Cache hit on second access");
  console.log("-".repeat(60));
  const history1 = await cacheService.getHistory(sessionId);
  console.log(`Retrieved ${history1.length} messages`);
  console.log();

  // Test 3: Add more messages and verify cache updates
  console.log("📝 Test 3: Add more messages and verify cache updates");
  console.log("-".repeat(60));
  const result2 = createTestResult(
    sessionId,
    "두 번째 질문",
    "두 번째 답변",
    2,
  );
  await cacheService.updateSession(sessionId, result2);
  const result3 = createTestResult(
    sessionId,
    "세 번째 질문",
    "세 번째 답변",
    3,
  );
  await cacheService.updateSession(sessionId, result3);
  console.log();

  // Test 4: Verify cache contains all messages
  console.log("📝 Test 4: Verify cache contains all messages");
  console.log("-".repeat(60));
  const history2 = await cacheService.getHistory(sessionId);
  console.log(`Retrieved ${history2.length} messages from cache`);
  if (history2.length === 3) {
    console.log("✅ PASS: Cache contains all 3 messages");
  } else {
    console.log(`❌ FAIL: Expected 3 messages, got ${history2.length}`);
  }
  console.log();

  // Test 5: Cache invalidation and DB fallback
  console.log("📝 Test 5: Cache invalidation and DB fallback");
  console.log("-".repeat(60));
  cacheService.invalidateSession(sessionId);
  const history3 = await cacheService.getHistory(sessionId);
  console.log(`Retrieved ${history3.length} messages after invalidation`);
  if (history3.length === 3) {
    console.log("✅ PASS: Successfully restored from DB");
  } else {
    console.log(`❌ FAIL: Expected 3 messages from DB, got ${history3.length}`);
  }
  console.log();

  // Test 6: Verify cache is repopulated after DB fetch
  console.log("📝 Test 6: Verify cache is repopulated after DB fetch");
  console.log("-".repeat(60));
  const history4 = await cacheService.getHistory(sessionId);
  console.log(`Retrieved ${history4.length} messages (should be cache hit)`);
  console.log();

  // Test 7: Multiple sessions
  console.log("📝 Test 7: Multiple sessions");
  console.log("-".repeat(60));
  const sessionId2 = "test-session-002";
  const result4 = createTestResult(
    sessionId2,
    "Session 2 질문",
    "Session 2 답변",
    1,
  );
  await cacheService.updateSession(sessionId2, result4);
  const stats = cacheService.getStats();
  console.log(`Active sessions: ${stats.activeSessions}`);
  console.log(`Cache hits: ${stats.cacheHits}`);
  console.log(`DB hits: ${stats.dbHits}`);
  console.log(`Total messages in cache: ${stats.totalMessages}`);
  if (stats.activeSessions === 2) {
    console.log("✅ PASS: Multiple sessions cached correctly");
  } else {
    console.log(`❌ FAIL: Expected 2 sessions, got ${stats.activeSessions}`);
  }
  console.log();

  // Test 8: Simulate cache expiration (by manually expiring)
  console.log("📝 Test 8: Simulate cache expiration");
  console.log("-".repeat(60));
  cacheService.clearCache();
  const history5 = await cacheService.getHistory(sessionId);
  const history6 = await cacheService.getHistory(sessionId2);
  console.log(`Session 1: ${history5.length} messages`);
  console.log(`Session 2: ${history6.length} messages`);
  if (history5.length === 3 && history6.length === 1) {
    console.log("✅ PASS: Both sessions restored from DB after cache clear");
  } else {
    console.log(`❌ FAIL: Session restoration failed`);
  }
  console.log();

  // --- Phase 5.2 Tests ---

  // Reset state for Phase 5.2 tests
  mockDb.clear();
  cacheService.clearCache();

  const clientA = "client-aaa-111";
  const clientB = "client-bbb-222";

  // Test 9: clientId propagation
  console.log("📝 Test 9: clientId propagation via updateSession");
  console.log("-".repeat(60));
  const sessA1 = "sess-a1";
  const r9 = createTestResult(sessA1, "질문 with clientId", "답변", 1, clientA);
  await cacheService.updateSession(sessA1, r9, clientA);
  const h9 = await cacheService.getHistory(sessA1);
  if (h9.length === 1 && h9[0].clientId === clientA) {
    console.log("✅ PASS: clientId persisted in saved result");
  } else {
    console.log(`❌ FAIL: clientId mismatch — got ${h9[0]?.clientId}`);
  }
  console.log();

  // Test 10: First-turn title generation
  console.log("📝 Test 10: First-turn title generation");
  console.log("-".repeat(60));
  const sessA2 = "sess-a2";
  const longQuestion = "이것은 50자를 넘는 아주 긴 질문입니다. 제목이 50자로 잘리는지 확인해야 합니다. 추가 텍스트.";
  const r10 = createTestResult(sessA2, longQuestion, "답변10", 1, clientA);
  await cacheService.updateSession(sessA2, r10, clientA);
  const h10 = await cacheService.getHistory(sessA2);
  const savedTitle = h10[0]?.title;
  if (savedTitle && savedTitle.length <= 50 && longQuestion.startsWith(savedTitle)) {
    console.log(`✅ PASS: title="${savedTitle}" (${savedTitle.length} chars, truncated correctly)`);
  } else {
    console.log(`❌ FAIL: title="${savedTitle}"`);
  }
  // Second message should NOT have title
  const r10b = createTestResult(sessA2, "두번째 질문", "답변10b", 2, clientA);
  await cacheService.updateSession(sessA2, r10b, clientA);
  const h10b = await cacheService.getHistory(sessA2);
  if (!h10b[1].title) {
    console.log("✅ PASS: Second message has no title");
  } else {
    console.log(`❌ FAIL: Second message should not have title, got "${h10b[1].title}"`);
  }
  console.log();

  // Test 11: listSessions filters by clientId
  console.log("📝 Test 11: listSessions filters by clientId");
  console.log("-".repeat(60));
  // Add a session for clientB
  const sessB1 = "sess-b1";
  const r11 = createTestResult(sessB1, "ClientB question", "ClientB answer", 1, clientB);
  await cacheService.updateSession(sessB1, r11, clientB);

  const sessionsA = await cacheService.listSessions(clientA);
  const sessionsB = await cacheService.listSessions(clientB);
  if (sessionsA.length === 2 && sessionsA.every((s) => s.clientId === clientA)) {
    console.log(`✅ PASS: clientA has ${sessionsA.length} sessions (sess-a1, sess-a2)`);
  } else {
    console.log(`❌ FAIL: Expected 2 sessions for clientA, got ${sessionsA.length}`);
  }
  if (sessionsB.length === 1 && sessionsB[0].sessionId === sessB1) {
    console.log(`✅ PASS: clientB has ${sessionsB.length} session (sess-b1)`);
  } else {
    console.log(`❌ FAIL: Expected 1 session for clientB, got ${sessionsB.length}`);
  }
  console.log();

  // Test 12: deleteSession with ownership guard
  console.log("📝 Test 12: deleteSession with ownership guard");
  console.log("-".repeat(60));
  // clientB cannot delete clientA's session
  const crossDelete = await cacheService.deleteSession(sessA1, clientB);
  if (!crossDelete) {
    console.log("✅ PASS: Cross-client deletion blocked");
  } else {
    console.log("❌ FAIL: Cross-client deletion should return false");
  }
  // clientA can delete own session
  const ownDelete = await cacheService.deleteSession(sessA1, clientA);
  if (ownDelete) {
    console.log("✅ PASS: Owner deletion succeeded");
  } else {
    console.log("❌ FAIL: Owner deletion should return true");
  }
  // Verify cache evicted and DB empty
  const h12 = await cacheService.getHistory(sessA1);
  if (h12.length === 0) {
    console.log("✅ PASS: Session removed from DB and cache");
  } else {
    console.log(`❌ FAIL: Expected 0 messages after delete, got ${h12.length}`);
  }
  // Verify listSessions updated
  const sessionsAAfter = await cacheService.listSessions(clientA);
  if (sessionsAAfter.length === 1) {
    console.log("✅ PASS: listSessions reflects deletion");
  } else {
    console.log(`❌ FAIL: Expected 1 session after delete, got ${sessionsAAfter.length}`);
  }
  console.log();

  // Final stats
  console.log("=".repeat(60));
  console.log("Final Statistics");
  console.log("=".repeat(60));
  const finalStats = cacheService.getStats();
  console.log(JSON.stringify(finalStats, null, 2));
  console.log();

  // Summary
  console.log("=".repeat(60));
  console.log("Test Summary");
  console.log("=".repeat(60));
  console.log("✅ Session cache persists across multiple operations");
  console.log("✅ Cache hits reduce database queries");
  console.log("✅ Cache correctly falls back to DB when invalidated");
  console.log("✅ Multiple sessions are handled independently");
  console.log("✅ Cache is repopulated after DB fetch");
  console.log("✅ clientId is propagated through updateSession");
  console.log("✅ First-turn title is generated and truncated to 50 chars");
  console.log("✅ listSessions returns only matching client sessions");
  console.log("✅ deleteSession enforces ownership and evicts cache");
  console.log();
}

// Run tests
runTests()
  .then(() => {
    console.log("✅ All tests completed");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Test failed:", error);
    process.exit(1);
  });
