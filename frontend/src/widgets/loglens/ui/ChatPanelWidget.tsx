"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import {
  Send,
  Bot,
  User,
  ExternalLink,
  Clock,
  AlertCircle,
  CheckCircle2,
  Info,
  Loader2,
} from "lucide-react"
import { ScrollArea } from "@/shared/ui/scroll-area"
import type { ChatMessage, LogSource } from "@/shared/lib/loglens"
import { cn } from "@/shared/lib/cn"

interface ChatPanelProps {
  messages: ChatMessage[]
  onSendMessage: (message: string) => void
  isLoading: boolean
  sessionId: string
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "ERROR":
      return <AlertCircle className="size-3.5 text-destructive" />
    case "WARN":
      return <AlertCircle className="size-3.5 text-warning" />
    case "INFO":
      return <CheckCircle2 className="size-3.5 text-success" />
    default:
      return <Info className="size-3.5 text-muted-foreground" />
  }
}

function SourceCard({ source }: { source: LogSource }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-muted/50 p-3 transition-colors hover:bg-muted">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <StatusIcon status={source.status} />
          <span
            className={cn(
              "text-xs font-medium font-mono",
              source.status === "ERROR"
                ? "text-destructive"
                : source.status === "WARN"
                ? "text-warning"
                : "text-success"
            )}
          >
            {source.status}
          </span>
        </div>
        <span className="text-xs text-muted-foreground font-mono">
          {source.duration.toLocaleString()}ms
        </span>
      </div>
      <p className="text-xs text-foreground leading-relaxed">{source.summary}</p>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="font-mono">{source.route}</span>
        <span className="flex items-center gap-1">
          <Clock className="size-3" />
          {new Date(source.timestamp).toLocaleTimeString()}
        </span>
      </div>
    </div>
  )
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user"

  return (
    <div className={cn("flex gap-3", isUser ? "flex-row-reverse" : "flex-row")}>
      <div
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full",
          isUser ? "bg-primary" : "bg-secondary"
        )}
      >
        {isUser ? (
          <User className="size-4 text-primary-foreground" />
        ) : (
          <Bot className="size-4 text-secondary-foreground" />
        )}
      </div>
      <div
        className={cn(
          "flex max-w-[85%] flex-col gap-2",
          isUser ? "items-end" : "items-start"
        )}
      >
        <div
          className={cn(
            "rounded-2xl px-4 py-3 text-sm leading-relaxed",
            isUser
              ? "rounded-br-md bg-primary text-primary-foreground"
              : "rounded-bl-md bg-secondary text-secondary-foreground"
          )}
        >
          <div className="whitespace-pre-wrap">{message.content}</div>
        </div>
        {message.sources && message.sources.length > 0 && (
          <div className="flex w-full flex-col gap-2">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ExternalLink className="size-3" />
              <span>{message.sources.length} log sources referenced</span>
            </div>
            <div className="grid gap-2">
              {message.sources.map((source) => (
                <SourceCard key={source.id} source={source} />
              ))}
            </div>
          </div>
        )}
        <span className="text-xs text-muted-foreground">
          {message.timestamp.toLocaleTimeString()}
        </span>
      </div>
    </div>
  )
}

export function ChatPanelWidget({
  messages,
  onSendMessage,
  isLoading,
  sessionId,
}: ChatPanelProps) {
  const [input, setInput] = useState("")
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      const viewport = scrollRef.current.querySelector(
        '[data-slot="scroll-area-viewport"]'
      )
      if (viewport) {
        viewport.scrollTop = viewport.scrollHeight
      }
    }
  }, [messages])

  const handleSubmit = useCallback(() => {
    if (!input.trim() || isLoading) return
    onSendMessage(input.trim())
    setInput("")
  }, [input, isLoading, onSendMessage])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        handleSubmit()
      }
    },
    [handleSubmit]
  )

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10">
            <Bot className="size-4 text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">LogLens AI</h3>
            <p className="text-xs text-muted-foreground">Semantic log search</p>
          </div>
        </div>
        <span className="rounded-md bg-muted px-2 py-1 text-xs font-mono text-muted-foreground">
          {sessionId.slice(0, 12)}
        </span>
      </div>

      <ScrollArea
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-hidden p-4"
      >
        <div className="flex flex-col gap-4">
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
          {isLoading && (
            <div className="flex gap-3">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary">
                <Bot className="size-4 text-secondary-foreground" />
              </div>
              <div className="flex items-center gap-2 rounded-2xl rounded-bl-md bg-secondary px-4 py-3">
                <Loader2 className="size-4 animate-spin text-primary" />
                <span className="text-sm text-muted-foreground">
                  Searching logs...
                </span>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="border-t border-border p-4">
        <div className="flex items-end gap-2 rounded-xl border border-border bg-muted/50 p-2 focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20 transition-all">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your logs... (e.g. 'What caused recent payment failures?')"
            className="flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            rows={1}
            style={{ maxHeight: "120px" }}
            aria-label="Search logs with natural language"
          />
          <button
            onClick={handleSubmit}
            disabled={!input.trim() || isLoading}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Send message"
          >
            <Send className="size-4" />
          </button>
        </div>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          {"RAG-powered search across wide events. Session context is preserved."}
        </p>
      </div>
    </div>
  )
}

