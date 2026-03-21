"use client"

import type { PercentileRow } from "@/shared/lib/loglens"

interface PercentilesWidgetProps {
  rows: PercentileRow[]
}

export function PercentilesWidget({ rows }: PercentilesWidgetProps) {
  if (rows.length === 0) return null

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">
          Latency percentiles
        </h3>
        <p className="text-xs text-muted-foreground">Distribution (ms)</p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {rows.map((r) => (
          <div
            key={r.percentile}
            className="rounded-lg border border-border bg-muted/20 p-3 text-center"
          >
            <div className="text-[10px] font-medium text-muted-foreground">
              {r.percentile}
            </div>
            <div className="mt-1 font-mono text-lg font-semibold text-foreground">
              {r.valueMs}ms
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
