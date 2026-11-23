"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Send, Square } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { HazardBadge, ListBadge } from "@/components/chem-badges";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ChemChatMessage } from "@/lib/ai/chat-agent";

const STARTERS = [
  "Corn grower needs a pre-emergent for waterhemp. What can I offer?",
  "Customer wants a low-hazard nonionic surfactant to tank-mix with glyphosate.",
  "What fungicide ingredients do we carry for soybean white mold?",
];

type Part = ChemChatMessage["parts"][number];

export function ChemChat({ initialQuestion }: { initialQuestion?: string }) {
  const [input, setInput] = useState(initialQuestion ?? "");
  const { messages, sendMessage, status, stop, error } = useChat<ChemChatMessage>({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });
  const busy = status === "submitted" || status === "streaming";

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    sendMessage({ text: trimmed });
    setInput("");
  };

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        Describe your customer&apos;s need (crop, pest, application, constraints) and the assistant will find chemicals and
        products in Allochemix you could offer.
      </p>

      {messages.length === 0 && (
        <div className="flex flex-wrap gap-2">
          {STARTERS.map((s) => (
            <Button key={s} variant="outline" size="sm" className="h-auto py-1.5 text-left whitespace-normal" onClick={() => send(s)}>
              {s}
            </Button>
          ))}
        </div>
      )}

      <div className="space-y-4">
        {messages.map((m) => (
          <div key={m.id} className={m.role === "user" ? "flex justify-end" : "space-y-3"}>
            {m.role === "user" ? (
              <div className="bg-secondary max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap">
                {m.parts.map((p) => (p.type === "text" ? p.text : "")).join("")}
              </div>
            ) : (
              m.parts.map((part, i) => <AssistantPart key={`${m.id}-${i}`} part={part} />)
            )}
          </div>
        ))}
        {status === "submitted" && <p className="text-muted-foreground text-sm">Thinking…</p>}
        {error && <p className="text-destructive text-sm">Something went wrong. {error.message}</p>}
      </div>

      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <Textarea
          value={input}
          onChange={(e) => setInput(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          placeholder="e.g. Wheat customer in Kansas needs a broadleaf herbicide that isn't on Prop 65"
          aria-label="Message the Allochemix assistant"
          rows={2}
          className="min-h-12 resize-none"
        />
        {busy ? (
          <Button type="button" variant="outline" size="icon-lg" onClick={stop} aria-label="Stop">
            <Square />
          </Button>
        ) : (
          <Button type="submit" size="icon-lg" disabled={!input.trim()} aria-label="Send">
            <Send />
          </Button>
        )}
      </form>
      <p className="text-muted-foreground text-xs">
        AI suggestions can be wrong. Confirm registration, the label and the SDS before selling.
      </p>
    </div>
  );
}

function AssistantPart({ part }: { part: Part }) {
  switch (part.type) {
    case "text":
      return <p className="text-sm leading-relaxed whitespace-pre-wrap">{part.text}</p>;
    case "tool-findChemicals":
      if (part.state === "output-available") {
        const looked = part.input.queries.join(", ");
        if (part.output.length === 0) return <ToolNote>No chemicals matched {looked}.</ToolNote>;
        return (
          <ResultCard title={`${part.output.length} chemicals for ${looked}${part.input.agChem ? " · Ag Chem" : ""}`}>
            {part.output.map((c) => (
              <li key={c.cas}>
                <Link href={c.url} className="hover:bg-muted/40 flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                  <span className="text-sm font-medium">{c.name}</span>
                  <span className="text-muted-foreground font-mono text-xs">CAS {c.cas}</span>
                  <HazardBadge score={c.hazardScore} />
                  {c.lists.map((code) => (
                    <ListBadge key={code} code={code} />
                  ))}
                </Link>
              </li>
            ))}
          </ResultCard>
        );
      }
      if (part.state === "output-error") return <ToolNote>Chemical search failed.</ToolNote>;
      return <ToolNote>Searching chemicals…</ToolNote>;
    case "tool-findProducts":
      if (part.state === "output-available") {
        if (part.output.products.length === 0) return <ToolNote>No products matched “{part.input.query}”.</ToolNote>;
        return (
          <ResultCard
            title={`Products for “${part.input.query || "Ag Chem"}” (${part.output.total.toLocaleString()} total)`}
          >
            {part.output.products.map((p) => (
              <li key={p.url}>
                <Link href={p.url} className="hover:bg-muted/40 flex flex-col px-3 py-2">
                  <span className="text-sm font-medium">{p.name}</span>
                  <span className="text-muted-foreground text-xs">{[p.maker, p.category].filter(Boolean).join(" · ")}</span>
                </Link>
              </li>
            ))}
          </ResultCard>
        );
      }
      if (part.state === "output-error") return <ToolNote>Product search failed.</ToolNote>;
      return <ToolNote>Searching products…</ToolNote>;
    default:
      return null;
  }
}

function ToolNote({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground text-xs">{children}</p>;
}

function ResultCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="rounded-lg border">
      <summary className="text-muted-foreground cursor-pointer px-3 py-2 text-xs">{title}</summary>
      <ul className="divide-border/60 divide-y border-t">{children}</ul>
    </details>
  );
}
