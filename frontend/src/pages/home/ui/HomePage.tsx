import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Activity,
  ArrowLeft,
  Layers,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react"
import {
  INITIAL_MESSAGES,
  MOCK_ROUTE_METRICS,
  MOCK_SESSIONS,
  MOCK_STATS,
  MOCK_STATUS_DISTRIBUTION,
  generateTimeSeriesData,
} from "@/shared/lib/loglens"
import type {
  AnalysisResult,
  ChatMessage,
  LogStats,
  RouteMetric,
  TimeSeriesPoint,
} from "@/shared/lib/loglens"
import { cn } from "@/shared/lib/cn"
import { getSessionHistory, searchLogs } from "@/shared/api/logSearch"
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

export function HomePage() {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>(
    INITIAL_MESSAGES.map((m) => ({ ...m, timestamp: new Date() })),
  )
  const [isLoading, setIsLoading] = useState(false)
  const [analyticsOverview, setAnalyticsOverview] =
    useState<LogStats | null>(MOCK_STATS)
  const [analyticsTimeseries, setAnalyticsTimeseries] = useState<
    TimeSeriesPoint[]
  >(generateTimeSeriesData())
  const [analyticsRoutes, setAnalyticsRoutes] =
    useState<RouteMetric[]>(MOCK_ROUTE_METRICS)
  const [showAnalyticsPanel, setShowAnalyticsPanel] = useState(false)
  const [showOverviewCard, setShowOverviewCard] = useState(false)
  const [showRoutesPanel, setShowRoutesPanel] = useState(false)

  // Regenerate time series data on mount to ensure fresh data
  useEffect(() => {
    const fresh = generateTimeSeriesData()
    setAnalyticsTimeseries(fresh)
  }, [])

  const mapHistoryToMessages = useCallback(
    (items: AnalysisResult[]): ChatMessage[] => {
      if (!items || items.length === 0) {
        return INITIAL_MESSAGES.map((m) => ({ ...m, timestamp: new Date() }))
      }

      return items.map((item, index) => ({
        id: `hist-${index}-${item.sessionId ?? "session"}`,
        role: "assistant",
        content: item.answer || "",
        timestamp: item.createdAt ? new Date(item.createdAt) : new Date(),
        sources: item.sources,
      }))
    },
    [],
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

          setShowAnalyticsPanel(analyticsAvailable)

          // Conversational/Semantic should stay chat-focused.
          if (!analyticsAvailable) {
            setShowOverviewCard(false)
            setShowRoutesPanel(false)
          }

          if (analyticsAvailable && result.statsPayload) {
            if (result.statsPayload.overview) {
              setAnalyticsOverview((prev) => ({
                ...(prev || MOCK_STATS),
                ...(result.statsPayload!.overview as Partial<LogStats>),
              }))
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
          }
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
    [activeSessionId],
  )

  const handleNewSession = useCallback(() => {
    const newId = `sess-${Date.now()}`
    setActiveSessionId(newId)
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
            sessions={MOCK_SESSIONS}
            activeSessionId={activeSessionId ?? ""}
            onSelectSession={handleSelectSession}
            onNewSession={handleNewSession}
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
                    onClick={() => setActiveSessionId(null)}
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
                    <div className="flex flex-col gap-4 overflow-auto lg:col-span-2">
                      {showOverviewCard && analyticsOverview && (
                        <StatsOverviewWidget stats={analyticsOverview} />
                      )}
                      <div className="grid gap-4">
                        <RequestVolumeChartWidget data={analyticsTimeseries} />
                        <LatencyChartWidget data={analyticsTimeseries} />
                      </div>
                      {showRoutesPanel && (
                        <div className="grid gap-4">
                          <StatusPieChartWidget data={MOCK_STATUS_DISTRIBUTION} />
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

