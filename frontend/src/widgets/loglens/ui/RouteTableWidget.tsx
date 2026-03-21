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
            {data.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="py-8 text-center text-muted-foreground"
                >
                  No data
                </td>
              </tr>
            ) : (
              data.map((route) => {
                const total = route.total ?? 0
                const failed = route.failed ?? 0
                const averageDurationMs = route.averageDurationMs ?? 0
                const derivedErrorPct =
                  total > 0 ? (failed / total) * 100 : undefined
                const errorPct = (
                  derivedErrorPct ?? (route.successRate !== undefined ? 100 - route.successRate : 0)
                ).toFixed(1)
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
                      {total > 0 ? `${(total / 1000).toFixed(1)}k` : "N/A"}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-destructive">
                      {failed.toLocaleString()}
                    </td>
                    <td className={cn("py-2.5 px-3 text-right font-mono font-medium", errorLevel)}>
                      {errorPct}%
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-muted-foreground">
                      {route.averageDurationMs !== undefined ? `${averageDurationMs}ms` : "N/A"}
                    </td>
                    <td className="py-2.5 pl-3 text-right font-mono text-muted-foreground">
                      N/A
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

