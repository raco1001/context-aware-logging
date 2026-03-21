"use client"

import {
  Activity,
  AlertTriangle,
  Clock,
  Gauge,
  TrendingDown,
  Zap,
} from "lucide-react"
import type { LogStats } from "@/shared/lib/loglens"

interface StatsOverviewProps {
  stats: LogStats
}

export function StatsOverviewWidget({ stats }: StatsOverviewProps) {
  const failedRequests = stats.failedRequests ?? 0
  const errorRate =
    stats.totalRequests > 0 ? ((failedRequests / stats.totalRequests) * 100).toFixed(1) : "0.0"

  const cards = [
    {
      label: "Total Requests",
      value: stats.totalRequests.toLocaleString(),
      icon: Activity,
      accent: "text-primary",
      bgAccent: "bg-primary/10",
      sub: "Last 24h",
    },
    {
      label: "Error Rate",
      value: `${errorRate}%`,
      icon: AlertTriangle,
      accent: "text-destructive",
      bgAccent: "bg-destructive/10",
      sub: `${failedRequests.toLocaleString()} errors`,
    },
    {
      label: "Avg Latency",
      value: `${stats.averageDurationMs}ms`,
      icon: Zap,
      accent: "text-success",
      bgAccent: "bg-success/10",
      sub: "Within SLA",
    },
    {
      label: "P99 Latency",
      value: "N/A",
      icon: Clock,
      accent: "text-warning",
      bgAccent: "bg-warning/10",
      sub: "Not available",
    },
    {
      label: "Success Rate",
      value: `${stats.successRate.toFixed(1)}%`,
      icon: Gauge,
      accent: "text-success",
      bgAccent: "bg-success/10",
      sub: "2xx responses",
    },
    {
      label: "Error Trend",
      value: "N/A",
      icon: TrendingDown,
      accent: "text-muted-foreground",
      bgAccent: "bg-muted/50",
      sub: "No data",
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
      {cards.map((card) => (
        <div
          key={card.label}
          className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 transition-colors hover:bg-accent/50"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              {card.label}
            </span>
            <div className={`rounded-lg p-1.5 ${card.bgAccent}`}>
              <card.icon className={`size-3.5 ${card.accent}`} />
            </div>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-xl font-bold tracking-tight text-foreground font-mono">
              {card.value}
            </span>
            <span className="text-xs text-muted-foreground">{card.sub}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

