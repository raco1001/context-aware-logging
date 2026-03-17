"use client"

import { MessageSquarePlus, Search, Clock } from "lucide-react"
import { ScrollArea } from "@/shared/ui/scroll-area"
import type { ChatSession } from "@/shared/lib/loglens"
import { cn } from "@/shared/lib/cn"

interface SessionSidebarProps {
  sessions: ChatSession[]
  activeSessionId: string
  onSelectSession: (id: string) => void
  onNewSession: () => void
}

export function SessionSidebarWidget({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
}: SessionSidebarProps) {
  function formatRelativeTime(date: Date): string {
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMin = Math.floor(diffMs / 60000)
    const diffHr = Math.floor(diffMin / 60)
    const diffDay = Math.floor(diffHr / 24)

    if (diffMin < 1) return "just now"
    if (diffMin < 60) return `${diffMin}m ago`
    if (diffHr < 24) return `${diffHr}h ago`
    return `${diffDay}d ago`
  }

  return (
    <div className="flex h-full flex-col border-r border-border bg-sidebar">
      <div className="flex items-center justify-between border-b border-border p-4">
        <div className="flex items-center gap-2">
          <Search className="size-4 text-primary" />
          <h2 className="text-sm font-semibold text-sidebar-foreground">Sessions</h2>
        </div>
        <button
          onClick={onNewSession}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <MessageSquarePlus className="size-3.5" />
          <span>New</span>
        </button>
      </div>
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-1 p-2">
          {sessions.map((session) => (
            <button
              key={session.id}
              onClick={() => onSelectSession(session.id)}
              className={cn(
                "flex w-full flex-col gap-1.5 rounded-lg p-3 text-left transition-colors",
                activeSessionId === session.id
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/50"
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="line-clamp-1 text-sm font-medium">
                  {session.title}
                </span>
                <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="size-3" />
                  {formatRelativeTime(session.createdAt)}
                </span>
              </div>
              <p className="line-clamp-2 text-xs text-muted-foreground leading-relaxed">
                {session.lastMessage}
              </p>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {session.messageCount} messages
                </span>
              </div>
            </button>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}

