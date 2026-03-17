"use client"

import { useMemo } from "react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/shared/ui/chart"
import type { TimeSeriesPoint, StatusDistribution, RouteMetric } from "@/shared/lib/loglens"

interface RequestVolumeChartProps {
  data: TimeSeriesPoint[]
}

export function RequestVolumeChartWidget({ data }: RequestVolumeChartProps) {
  const chartConfig = useMemo(
    () => ({
      requests: { label: "Requests", color: "#4cc9f0" },
      errors: { label: "Errors", color: "#f87171" },
    }),
    []
  )

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Request Volume</h3>
          <p className="text-xs text-muted-foreground">Requests & errors over 24h</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <div className="size-2 rounded-full" style={{ backgroundColor: "#4cc9f0" }} />
            <span className="text-xs text-muted-foreground">Requests</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="size-2 rounded-full" style={{ backgroundColor: "#f87171" }} />
            <span className="text-xs text-muted-foreground">Errors</span>
          </div>
        </div>
      </div>
      <ChartContainer config={chartConfig} className="h-[200px] w-full">
        <AreaChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="requestGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#4cc9f0" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#4cc9f0" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="errorGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#f87171" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#f87171" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.24 0.012 260)" />
          <XAxis
            dataKey="time"
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Area
            type="monotone"
            dataKey="requests"
            stroke="#4cc9f0"
            fill="url(#requestGrad)"
            strokeWidth={2}
          />
          <Area
            type="monotone"
            dataKey="errors"
            stroke="#f87171"
            fill="url(#errorGrad)"
            strokeWidth={2}
          />
        </AreaChart>
      </ChartContainer>
    </div>
  )
}

interface LatencyChartProps {
  data: TimeSeriesPoint[]
}

export function LatencyChartWidget({ data }: LatencyChartProps) {
  const chartConfig = useMemo(
    () => ({
      latency: { label: "Avg Latency (ms)", color: "#a78bfa" },
    }),
    []
  )

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Latency Trend</h3>
          <p className="text-xs text-muted-foreground">Average response time (ms)</p>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="size-2 rounded-full" style={{ backgroundColor: "#a78bfa" }} />
          <span className="text-xs text-muted-foreground">Latency</span>
        </div>
      </div>
      <ChartContainer config={chartConfig} className="h-[200px] w-full">
        <AreaChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="latencyGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#a78bfa" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.24 0.012 260)" />
          <XAxis
            dataKey="time"
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Area
            type="monotone"
            dataKey="latency"
            stroke="#a78bfa"
            fill="url(#latencyGrad)"
            strokeWidth={2}
          />
        </AreaChart>
      </ChartContainer>
    </div>
  )
}

interface StatusPieChartProps {
  data: StatusDistribution[]
}

export function StatusPieChartWidget({ data }: StatusPieChartProps) {
  const total = data.reduce((sum, d) => sum + d.count, 0)
  const chartConfig = useMemo(
    () => ({
      "2xx": { label: "2xx Success", color: "#4ade80" },
      "4xx": { label: "4xx Client", color: "#fb923c" },
      "5xx": { label: "5xx Server", color: "#f87171" },
    }),
    []
  )

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Status Distribution</h3>
        <p className="text-xs text-muted-foreground">Response codes breakdown</p>
      </div>
      <div className="flex items-center gap-4">
        <ChartContainer config={chartConfig} className="h-[160px] w-[160px]">
          <PieChart>
            <ChartTooltip content={<ChartTooltipContent />} />
            <Pie
              data={data}
              dataKey="count"
              nameKey="status"
              cx="50%"
              cy="50%"
              innerRadius={45}
              outerRadius={70}
              strokeWidth={2}
              stroke="oklch(0.16 0.007 260)"
            >
              {data.map((entry) => (
                <Cell key={entry.status} fill={entry.fill} />
              ))}
            </Pie>
          </PieChart>
        </ChartContainer>
        <div className="flex flex-col gap-2">
          {data.map((entry) => (
            <div key={entry.status} className="flex items-center gap-2">
              <div
                className="size-2.5 rounded-full"
                style={{ backgroundColor: entry.fill }}
              />
              <span className="text-xs text-muted-foreground">{entry.status}</span>
              <span className="text-xs font-medium font-mono text-foreground">
                {((entry.count / total) * 100).toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

interface RouteMetricsChartProps {
  data: RouteMetric[]
}

export function RouteMetricsChartWidget({ data }: RouteMetricsChartProps) {
  const chartConfig = useMemo(
    () => ({
      requests: { label: "Requests", color: "#4cc9f0" },
      errors: { label: "Errors", color: "#f87171" },
    }),
    []
  )

  const chartData = data.map((d) => ({
    route: d.route.split(" ")[1] || d.route,
    requests: d.requests,
    errors: d.errors,
  }))

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Route Metrics</h3>
        <p className="text-xs text-muted-foreground">Traffic by endpoint</p>
      </div>
      <ChartContainer config={chartConfig} className="h-[200px] w-full">
        <BarChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.24 0.012 260)" />
          <XAxis
            dataKey="route"
            tick={{ fontSize: 9 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Bar dataKey="requests" fill="#4cc9f0" radius={[4, 4, 0, 0]} />
          <Bar dataKey="errors" fill="#f87171" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ChartContainer>
    </div>
  )
}

