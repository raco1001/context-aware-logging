"use client"

import type { BreakdownRow } from "@/shared/lib/loglens"

interface BreakdownWidgetProps {
  title: string
  rows: BreakdownRow[]
}

export function BreakdownWidget({ title, rows }: BreakdownWidgetProps) {
  if (rows.length === 0) return null

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="text-xs text-muted-foreground">Frequency breakdown</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="pb-2 pr-4 text-left font-medium">Label</th>
              <th className="pb-2 pl-3 text-right font-medium">Count</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={`${row.label}-${row.count}`}
                className="border-b border-border/50 last:border-0 transition-colors hover:bg-muted/30"
              >
                <td className="py-2.5 pr-4 font-mono font-medium text-foreground">
                  {row.label}
                </td>
                <td className="py-2.5 pl-3 text-right font-mono text-muted-foreground">
                  {row.count.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
