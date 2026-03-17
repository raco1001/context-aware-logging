"use client"

import type { RouteMetric } from "@/shared/lib/loglens"
import { cn } from "@/shared/lib/cn"

interface RouteTableProps {
  data: RouteMetric[]
}

export function RouteTableWidget({ data }: RouteTableProps) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Endpoint Health</h3>
        <p className="text-xs text-muted-foreground">Per-route performance overview</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="pb-2 pr-4 text-left font-medium">Route</th>
              <th className="pb-2 px-3 text-right font-medium">Requests</th>
              <th className="pb-2 px-3 text-right font-medium">Errors</th>
              <th className="pb-2 px-3 text-right font-medium">Error %</th>
              <th className="pb-2 px-3 text-right font-medium">Avg</th>
              <th className="pb-2 pl-3 text-right font-medium">P99</th>
            </tr>
          </thead>
          <tbody>
            {data.map((route) => {
              const errorPct = ((route.errors / route.requests) * 100).toFixed(1)
              const errorLevel =
                Number(errorPct) > 10
                  ? "text-destructive"
                  : Number(errorPct) > 5
                  ? "text-warning"
                  : "text-success"
              return (
                <tr
                  key={route.route}
                  className="border-b border-border/50 last:border-0 transition-colors hover:bg-muted/30"
                >
                  <td className="py-2.5 pr-4 font-mono font-medium text-foreground">
                    {route.route}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-muted-foreground">
                    {(route.requests / 1000).toFixed(1)}k
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-destructive">
                    {route.errors.toLocaleString()}
                  </td>
                  <td className={cn("py-2.5 px-3 text-right font-mono font-medium", errorLevel)}>
                    {errorPct}%
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-muted-foreground">
                    {route.avgLatency}ms
                  </td>
                  <td
                    className={cn(
                      "py-2.5 pl-3 text-right font-mono",
                      route.p99Latency > 2000 ? "text-destructive" : "text-muted-foreground"
                    )}
                  >
                    {route.p99Latency.toLocaleString()}ms
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

