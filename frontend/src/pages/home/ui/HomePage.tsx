import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Activity,
  ArrowLeft,
  Layers,
  Lock,
  LockOpen,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react"
import { INITIAL_MESSAGES } from "@/shared/lib/loglens"
import type {
  AnalysisResult,
  ChatMessage,
  ChatSession,
  LogStats,
  RouteMetric,
  SessionSummary,
  StatusDistribution,
  TimeSeriesPoint,
} from "@/shared/lib/loglens"
import { cn } from "@/shared/lib/cn"
import {
  deleteSession,
  getSessionHistory,
  getSessionList,
  searchLogs,
} from "@/shared/api/logSearch"
import {
  ChatPanelWidget,
  LatencyChartWidget,
  RequestVolumeChartWidget,
  RouteMetricsChartWidget,
  RouteTableWidget,
  SessionSidebarWidget,
  StatsOverviewWidget,
  StatusPieChartWidget,
} from "@/widgets/loglens"

const SESSION_LIST_REFRESH_MS = 500

function mapSummariesToChatSessions(items: SessionSummary[]): ChatSession[] {
  return items.map((s) => ({
    id: s.sessionId,
    title: s.title,
    lastMessage: s.lastMessage,
    createdAt: new Date(s.createdAt),
    messageCount: s.messageCount,
  }))
}

export function HomePage() {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(() =>
    localStorage.getItem("loglens-active-session"),
  )
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const refreshSessionsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  )
  const [messages, setMessages] = useState<ChatMessage[]>(
    INITIAL_MESSAGES.map((m) => ({ ...m, timestamp: new Date() })),
  )
  const [isLoading, setIsLoading] = useState(false)
  const [analyticsOverview, setAnalyticsOverview] =
    useState<LogStats | null>(null)
  const [analyticsTimeseries, setAnalyticsTimeseries] = useState<
    TimeSeriesPoint[]
  >([])
  const [analyticsRoutes, setAnalyticsRoutes] = useState<RouteMetric[]>([])
  const [analyticsStatusDistribution, setAnalyticsStatusDistribution] =
    useState<StatusDistribution[] | null>(null)
  const [showAnalyticsPanel, setShowAnalyticsPanel] = useState(false)
  const [showOverviewCard, setShowOverviewCard] = useState(false)
  const [showRoutesPanel, setShowRoutesPanel] = useState(false)
  const [isChartLocked, setIsChartLocked] = useState(false)

  const mapHistoryToMessages = useCallback(
    (items: AnalysisResult[]): ChatMessage[] => {
      if (!items || items.length === 0) {
        return INITIAL_MESSAGES.map((m) => ({ ...m, timestamp: new Date() }))
      }

      return items.flatMap((item, index) => {
        const ts = item.createdAt ? new Date(item.createdAt) : new Date()
        const messages: ChatMessage[] = []
        if (item.question) {
          messages.push({
            id: `hist-${index}-user-${item.sessionId ?? "session"}`,
            role: "user",
            content: item.question,
            timestamp: ts,
          })
        }
        messages.push({
          id: `hist-${index}-${item.sessionId ?? "session"}`,
          role: "assistant",
          content: item.answer || "",
          timestamp: ts,
          sources: item.sources,
        })
        return messages
      })
    },
    [],
  )

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true)
    try {
      const { res, data } = await getSessionList()
      if (res.ok && Array.isArray(data)) {
        setSessions(mapSummariesToChatSessions(data))
      }
    } finally {
      setSessionsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSessions()
  }, [loadSessions])

  useEffect(() => {
    const stored = localStorage.getItem("loglens-active-session")
    if (!stored) return
    let cancelled = false
    ;(async () => {
      setIsLoading(true)
      try {
        const { res, data } = await getSessionHistory(stored)
        if (cancelled) return
        if (res.ok && Array.isArray(data)) {
          setMessages(mapHistoryToMessages(data))
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [mapHistoryToMessages])

  useEffect(() => {
    if (activeSessionId) {
      localStorage.setItem("loglens-active-session", activeSessionId)
    }
  }, [activeSessionId])

  useEffect(() => {
    setIsChartLocked(false)
  }, [activeSessionId])

  const scheduleSessionListRefresh = useCallback(() => {
    if (refreshSessionsTimeoutRef.current) {
      clearTimeout(refreshSessionsTimeoutRef.current)
    }
    refreshSessionsTimeoutRef.current = setTimeout(() => {
      refreshSessionsTimeoutRef.current = null
      void (async () => {
        const { res, data } = await getSessionList()
        if (res.ok && Array.isArray(data)) {
          setSessions(mapSummariesToChatSessions(data))
        }
      })()
    }, SESSION_LIST_REFRESH_MS)
  }, [])

  useEffect(() => {
    return () => {
      if (refreshSessionsTimeoutRef.current) {
        clearTimeout(refreshSessionsTimeoutRef.current)
      }
    }
  }, [])

  const handleClearActiveSession = useCallback(() => {
    localStorage.removeItem("loglens-active-session")
    setActiveSessionId(null)
  }, [])

  const handleDeleteSession = useCallback(
    async (id: string) => {
      const { res, data } = await deleteSession(id)
      if (!res.ok || ("error" in data && data.error)) {
        return
      }
      setSessions((prev) => prev.filter((s) => s.id !== id))
      if (activeSessionId === id) {
        localStorage.removeItem("loglens-active-session")
        setActiveSessionId(null)
        setMessages(
          INITIAL_MESSAGES.map((m) => ({ ...m, timestamp: new Date() })),
        )
      }
    },
    [activeSessionId],
  )

  const handleSendMessage = useCallback(
    async (content: string) => {
      const userMessage: ChatMessage = {
        id: `msg-${Date.now()}`,
        role: "user",
        content,
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, userMessage])
      setIsLoading(true)

      try {
        const { res, data } = await searchLogs(content, activeSessionId)

        if (!res.ok || "error" in data) {
          // Prefer backend-provided error when available
          const backendError =
            "error" in data
              ? `Search failed: ${data.error}${
                  data.message ? ` - ${data.message}` : ""
                }`
              : "Search failed due to an unknown error."

          const statusInfo = !res.ok
            ? ` (HTTP ${res.status} ${res.statusText || ""})`
            : ""

          // eslint-disable-next-line no-console
          console.error(
            "[LogLens] searchLogs failed",
            res.status,
            res.statusText,
            data,
          )

          const errorMessage: ChatMessage = {
            id: `msg-${Date.now()}-err`,
            role: "assistant",
            content: `${backendError}${statusInfo}`,
            timestamp: new Date(),
          }
          setMessages((prev) => [...prev, errorMessage])
        } else {
          const result = data as AnalysisResult
          const normalizedIntent =
            result.intent === "SEQUENTIAL" ? "SEMANTIC" : result.intent
          const normalizedViewType = result.viewType ?? "chat"
          const hasSources = Array.isArray(result.sources) && result.sources.length > 0
          const hasAnswer = Boolean(result.answer && result.answer.trim())
          const noSourceGuidance =
            hasAnswer && !hasSources ? "\n\n관련 로그를 찾지 못했습니다. 조건을 완화해서 다시 시도해 주세요." : ""
          const fallbackAnswer =
            normalizedIntent === "UNKNOWN"
              ? "분석 의도를 파악하지 못했습니다. 에러 코드, 서비스, 시간 범위를 포함해 다시 질문해 주세요."
              : "No results found."
          const aiMessage: ChatMessage = {
            id: `msg-${Date.now()}-ai`,
            role: "assistant",
            content: `${result.answer || fallbackAnswer}${noSourceGuidance}`,
            timestamp: new Date(),
            sources: result.sources,
          }
          setMessages((prev) => [...prev, aiMessage])

          const analyticsEnabledByViewType =
            normalizedViewType === "analytics" || normalizedViewType === "chat+analytics"
          const analyticsAvailable =
            normalizedIntent === "STATISTICAL" &&
            analyticsEnabledByViewType &&
            Boolean(result.statsPayload)

          if (!isChartLocked) {
            setShowAnalyticsPanel(analyticsAvailable)

            // Conversational/Semantic should stay chat-focused.
            if (!analyticsAvailable) {
              setShowOverviewCard(false)
              setShowRoutesPanel(false)
              setAnalyticsStatusDistribution(null)
            }

            if (analyticsAvailable && result.statsPayload) {
              if (result.statsPayload.overview) {
                setAnalyticsOverview((prev) => ({
                  ...(prev || {}),
                  ...(result.statsPayload!.overview as Partial<LogStats>),
                }) as LogStats)
                setShowOverviewCard(true)
              } else {
                setShowOverviewCard(false)
              }
              if (result.statsPayload.timeseries) {
                setAnalyticsTimeseries(
                  (result.statsPayload.timeseries as TimeSeriesPoint[]) || [],
                )
              }
              if (result.statsPayload.routes) {
                setAnalyticsRoutes(
                  (result.statsPayload.routes as RouteMetric[]) || [],
                )
                setShowRoutesPanel(true)
              } else {
                setShowRoutesPanel(false)
              }
              const dist = result.statsPayload.statusDistribution
              if (dist && dist.length > 0) {
                setAnalyticsStatusDistribution(dist)
              } else {
                setAnalyticsStatusDistribution(null)
              }
            }
          }

          scheduleSessionListRefresh()
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("[LogLens] searchLogs network failure", error)
        const errorMessage: ChatMessage = {
          id: `msg-${Date.now()}-err`,
          role: "assistant",
          content:
            "I encountered an error connecting to the backend. Please ensure the backend server is running at the configured BACKEND_URL.",
          timestamp: new Date(),
        }
        setMessages((prev) => [...prev, errorMessage])
      } finally {
        setIsLoading(false)
      }
    },
    [activeSessionId, isChartLocked, scheduleSessionListRefresh],
  )

  const handleNewSession = useCallback(() => {
    const newId = `sess-${Date.now()}`
    setActiveSessionId(newId)
    setSessions((prev) => [
      {
        id: newId,
        title: "New session",
        lastMessage: "",
        createdAt: new Date(),
        messageCount: 0,
      },
      ...prev.filter((s) => s.id !== newId),
    ])
    setMessages(
      INITIAL_MESSAGES.map((m) => ({
        ...m,
        id: `${m.id}-${newId}`,
        timestamp: new Date(),
      })),
    )
  }, [])

  const handleSelectSession = useCallback(
    async (id: string) => {
      setActiveSessionId(id)
      setIsLoading(true)

      try {
        const { res, data } = await getSessionHistory(id)

        if (!res.ok || !Array.isArray(data)) {
          // eslint-disable-next-line no-console
          console.error(
            "[LogLens] getSessionHistory failed",
            res.status,
            res.statusText,
            data,
          )

          setMessages(
            INITIAL_MESSAGES.map((m) => ({
              ...m,
              id: `${m.id}-${id}`,
              timestamp: new Date(),
            })),
          )
        } else {
          setMessages(mapHistoryToMessages(data))
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("[LogLens] getSessionHistory network failure", error)
        setMessages(
          INITIAL_MESSAGES.map((m) => ({
            ...m,
            id: `${m.id}-${id}`,
            timestamp: new Date(),
          })),
        )
      } finally {
        setIsLoading(false)
      }
    },
    [mapHistoryToMessages],
  )

  const sessionId = useMemo(
    () => activeSessionId,
    [activeSessionId],
  )

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* Top Header */}
      <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
          >
            {sidebarOpen ? (
              <PanelLeftClose className="size-4" />
            ) : (
              <PanelLeftOpen className="size-4" />
            )}
          </button>
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10">
              <Layers className="size-4 text-primary" />
            </div>
            <h1 className="text-base font-bold text-foreground tracking-tight">
              LogLens
            </h1>
            <span className="hidden rounded-md bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary sm:inline">
              RAG
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-lg bg-success/10 px-2.5 py-1">
            <div className="size-1.5 rounded-full bg-success animate-pulse" />
            <span className="text-xs font-medium text-success">Connected</span>
          </div>
          <div className="flex items-center gap-1 rounded-lg bg-muted px-2.5 py-1">
            <Activity className="size-3 text-muted-foreground" />
            <span className="text-xs text-muted-foreground font-mono">
              Phase 5
            </span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Session Sidebar */}
        <div
          className={cn(
            "shrink-0 transition-all duration-300 overflow-hidden",
            sidebarOpen ? "w-72" : "w-0",
          )}
        >
          <SessionSidebarWidget
            sessions={sessions}
            activeSessionId={activeSessionId ?? ""}
            onSelectSession={handleSelectSession}
            onNewSession={handleNewSession}
            onDeleteSession={handleDeleteSession}
            sessionsLoading={sessionsLoading}
          />
        </div>

        {/* Session-focused Main Area */}
        <div className="flex flex-1 flex-col overflow-hidden border-l border-border">
          {activeSessionId ? (
            <div className="flex h-full flex-col">
              {/* Session header with back button */}
              <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleClearActiveSession}
                    className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <ArrowLeft className="size-3.5" />
                    <span>All Sessions</span>
                  </button>
                  <div className="flex items-center gap-2">
                    <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10">
                      <Layers className="size-4 text-primary" />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-sm font-semibold text-foreground">
                        Session Detail
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Chat + analytics in one view
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Session detail body: chat + analytics */}
              <div className="flex flex-1 flex-col overflow-hidden">
                <div className="grid h-full gap-4 p-4 lg:grid-cols-5">
                  <div className="flex min-h-0 flex-col overflow-hidden lg:col-span-3">
                    <ChatPanelWidget
                      messages={messages}
                      onSendMessage={handleSendMessage}
                      isLoading={isLoading}
                      sessionId={sessionId ?? ""}
                    />
                  </div>
                  {showAnalyticsPanel ? (
                    <div
                      className={cn(
                        "flex flex-col gap-4 overflow-auto rounded-xl p-1 transition-[box-shadow,border-color] lg:col-span-2",
                        isChartLocked
                          ? "border border-amber-500/35 bg-amber-500/4 shadow-[inset_0_0_0_1px_rgba(245,158,11,0.12)]"
                          : "border border-transparent",
                      )}
                    >
                      <div className="flex shrink-0 items-center justify-between gap-2 px-1 pt-0.5">
                        <button
                          type="button"
                          onClick={() => setIsChartLocked((v) => !v)}
                          className={cn(
                            "inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
                            isChartLocked
                              ? "bg-amber-500/15 text-amber-900 dark:text-amber-100"
                              : "text-muted-foreground hover:bg-accent hover:text-foreground",
                          )}
                          aria-pressed={isChartLocked}
                          aria-label={
                            isChartLocked
                              ? "Unlock analytics updates"
                              : "Lock analytics snapshot"
                          }
                        >
                          {isChartLocked ? (
                            <Lock className="size-3.5" />
                          ) : (
                            <LockOpen className="size-3.5" />
                          )}
                          <span>
                            {isChartLocked ? "Snapshot" : "Live updates"}
                          </span>
                        </button>
                        {isChartLocked ? (
                          <span className="rounded-md border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-900 dark:text-amber-100">
                            Snapshot
                          </span>
                        ) : null}
                      </div>
                      {showOverviewCard ? (
                        analyticsOverview ? (
                          <StatsOverviewWidget stats={analyticsOverview} />
                        ) : (
                          <div className="rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
                            No stats available
                          </div>
                        )
                      ) : null}
                      <div className="grid gap-4">
                        <RequestVolumeChartWidget data={analyticsTimeseries} />
                        <LatencyChartWidget data={analyticsTimeseries} />
                      </div>
                      {showRoutesPanel && (
                        <div className="grid gap-4">
                          {analyticsStatusDistribution &&
                          analyticsStatusDistribution.length > 0 ? (
                            <StatusPieChartWidget
                              data={analyticsStatusDistribution}
                            />
                          ) : null}
                          <RouteMetricsChartWidget data={analyticsRoutes} />
                        </div>
                      )}
                      {showRoutesPanel && <RouteTableWidget data={analyticsRoutes} />}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center lg:col-span-2">
                      <p className="text-sm font-medium text-foreground">
                        Analytics panel is hidden for this response
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        통계형 응답(`STATISTICAL` + `analytics`/`chat+analytics`)일 때만 메트릭 패널이 표시됩니다.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-center text-muted-foreground">
              <div className="flex size-14 items-center justify-center rounded-2xl border border-dashed border-border bg-muted/40">
                <Layers className="size-7 text-primary" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">
                  세션을 선택하거나 새 세션을 생성하세요
                </p>
                <p className="text-xs text-muted-foreground">
                  좌측의 Sessions 영역에서 대화를 선택하면, 해당 세션의 채팅과 통계를 한 화면에서 볼 수 있습니다.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

