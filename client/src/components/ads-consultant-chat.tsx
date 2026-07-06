import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  MessageCircle, X, Send, Bot, User, Loader2, Sparkles,
} from "lucide-react";

type Message = {
  role: "user" | "assistant";
  content: string;
};

const QUICK_QUESTIONS = [
  "How do I set up a new campaign?",
  "What settings should I turn off?",
  "How do I pick the right keywords?",
  "How does Click Guard work?",
  "What's the best bidding strategy?",
  "How much should I budget per day?",
];

export default function AdsConsultantChat() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const sendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;

    const userMsg: Message = { role: "user", content: text.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setIsLoading(true);

    try {
      const res = await fetch("/api/ads-consultant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages }),
      });

      if (!res.ok) throw new Error("Failed to get response");

      const data = await res.json();
      setMessages(prev => [...prev, { role: "assistant", content: data.reply }]);
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "Sorry, I couldn't process that request. Please try again." }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const formatContent = (content: string) => {
    return content.split("\n").map((line, i) => {
      const parts = line.split(/(\*\*[^*]+\*\*)/g);
      const formatted = parts.map((part, j) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={j} className="text-white font-semibold">{part.slice(2, -2)}</strong>;
        }
        return part;
      });

      if (line.trim() === "") return <br key={i} />;
      return <p key={i} className="mb-2 last:mb-0">{formatted}</p>;
    });
  };

  return (
    <>
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 z-50 bg-gradient-to-r from-[#F97316] to-[#EF4444] text-white rounded-full p-4 shadow-2xl shadow-orange-500/30 hover:scale-105 transition-transform group"
          data-testid="button-open-chat"
        >
          <div className="relative">
            <MessageCircle className="h-6 w-6" />
            <Sparkles className="h-3 w-3 absolute -top-1 -right-1 text-yellow-300 animate-pulse" />
          </div>
          <span className="absolute bottom-full right-0 mb-2 px-3 py-1.5 bg-black/90 text-white text-xs rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
            Ask the Google Ads Bot
          </span>
        </button>
      )}

      {isOpen && (
        <div className="fixed bottom-6 right-6 z-50 w-[400px] max-w-[calc(100vw-2rem)] h-[600px] max-h-[calc(100vh-6rem)] flex flex-col rounded-2xl overflow-hidden shadow-2xl shadow-black/50 border border-white/[0.1]" data-testid="chat-window">
          <div className="bg-gradient-to-r from-[#F97316] to-[#EF4444] px-4 py-3 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="bg-white/20 rounded-full p-1.5">
                <Bot className="h-4 w-4 text-white" />
              </div>
              <div>
                <h3 className="text-white font-bold text-sm leading-tight">Google Ads Consultant</h3>
                <p className="text-white/70 text-[10px]">Powered by ConstructHUB knowledge base</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Badge className="bg-white/20 text-white border-0 text-[10px] px-1.5 py-0">AI</Badge>
              <button
                onClick={() => setIsOpen(false)}
                className="text-white/70 hover:text-white p-1 rounded-md hover:bg-white/10 transition-colors"
                data-testid="button-close-chat"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto bg-[#1a2035] px-4 py-4 space-y-4">
            {messages.length === 0 && (
              <div className="space-y-4">
                <div className="flex items-start gap-2.5">
                  <div className="bg-orange-500/20 rounded-full p-1.5 flex-shrink-0 mt-0.5">
                    <Bot className="h-3.5 w-3.5 text-orange-400" />
                  </div>
                  <div className="bg-white/[0.05] border border-white/[0.08] rounded-xl rounded-tl-sm px-3.5 py-2.5 max-w-[85%]">
                    <p className="text-white/70 text-sm leading-relaxed">
                      Hey! I'm your Google Ads consultant. I know everything in the ConstructHUB Master Class — campaign setup, keyword strategy, click fraud protection, bidding, and more. Ask me anything.
                    </p>
                  </div>
                </div>

                <div className="pl-9">
                  <p className="text-white/30 text-[11px] uppercase tracking-wider font-medium mb-2">Quick questions</p>
                  <div className="flex flex-wrap gap-1.5">
                    {QUICK_QUESTIONS.map((q, i) => (
                      <button
                        key={i}
                        onClick={() => sendMessage(q)}
                        className="text-xs bg-white/[0.05] border border-white/[0.1] text-white/60 hover:text-white hover:bg-white/[0.1] rounded-lg px-2.5 py-1.5 transition-colors text-left"
                        data-testid={`button-quick-question-${i}`}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`flex items-start gap-2.5 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
                <div className={`rounded-full p-1.5 flex-shrink-0 mt-0.5 ${msg.role === "user" ? "bg-blue-500/20" : "bg-orange-500/20"}`}>
                  {msg.role === "user" ? (
                    <User className="h-3.5 w-3.5 text-blue-400" />
                  ) : (
                    <Bot className="h-3.5 w-3.5 text-orange-400" />
                  )}
                </div>
                <div className={`rounded-xl px-3.5 py-2.5 max-w-[85%] text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-blue-500/20 border border-blue-500/20 text-white/90 rounded-tr-sm"
                    : "bg-white/[0.05] border border-white/[0.08] text-white/70 rounded-tl-sm"
                }`} data-testid={`message-${msg.role}-${i}`}>
                  {msg.role === "assistant" ? formatContent(msg.content) : msg.content}
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="flex items-start gap-2.5">
                <div className="bg-orange-500/20 rounded-full p-1.5 flex-shrink-0 mt-0.5">
                  <Bot className="h-3.5 w-3.5 text-orange-400" />
                </div>
                <div className="bg-white/[0.05] border border-white/[0.08] rounded-xl rounded-tl-sm px-3.5 py-3">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 text-orange-400 animate-spin" />
                    <span className="text-white/40 text-xs">Thinking...</span>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          <form onSubmit={handleSubmit} className="flex-shrink-0 bg-[#0d1117] border-t border-white/[0.08] px-3 py-3">
            <div className="flex items-center gap-2">
              <Input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about Google Ads..."
                disabled={isLoading}
                className="bg-white/[0.05] border-white/[0.1] text-white text-sm placeholder:text-white/30 focus-visible:ring-orange-500/50"
                data-testid="input-chat-message"
              />
              <Button
                type="submit"
                size="sm"
                disabled={!input.trim() || isLoading}
                className="bg-[#F97316] hover:bg-[#EA580C] text-white px-3 flex-shrink-0"
                data-testid="button-send-message"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
