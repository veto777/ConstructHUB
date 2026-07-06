import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  MessageCircle, X, Send, Bot, User, Loader2, Sparkles, ShieldCheck, Lock,
} from "lucide-react";

type Message = {
  role: "user" | "assistant";
  content: string;
};

const QUICK_QUESTIONS = [
  "What does ConstructHUB do?",
  "How does Click Guard protect my ads?",
  "What permit data do you cover?",
  "What's included in each plan?",
  "How does VPN Shield work?",
  "Tell me about the Master Class",
];

const RECAPTCHA_SITE_KEY = "6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI";
const FREE_INQUIRY_LIMIT = 3;

export default function SiteAssistantChat() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [inquiryCount, setInquiryCount] = useState(0);
  const [showCaptcha, setShowCaptcha] = useState(false);
  const [captchaVerified, setCaptchaVerified] = useState(false);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const captchaContainerRef = useRef<HTMLDivElement>(null);
  const captchaWidgetId = useRef<number | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!showCaptcha) return;

    const loadRecaptcha = () => {
      if ((window as any).grecaptcha && captchaContainerRef.current) {
        try {
          if (captchaWidgetId.current !== null) {
            (window as any).grecaptcha.reset(captchaWidgetId.current);
          }
          captchaWidgetId.current = (window as any).grecaptcha.render(captchaContainerRef.current, {
            sitekey: RECAPTCHA_SITE_KEY,
            callback: (token: string) => {
              setCaptchaVerified(true);
              setShowCaptcha(false);
              if (pendingMessage) {
                doSendMessage(pendingMessage, token);
                setPendingMessage(null);
              }
            },
            theme: "dark",
            size: "normal",
          });
        } catch {}
        return;
      }

      if (!document.querySelector('script[src*="recaptcha"]')) {
        const script = document.createElement("script");
        script.src = "https://www.google.com/recaptcha/api.js?onload=onRecaptchaLoad&render=explicit";
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
      }

      (window as any).onRecaptchaLoad = () => {
        if (captchaContainerRef.current) {
          captchaWidgetId.current = (window as any).grecaptcha.render(captchaContainerRef.current, {
            sitekey: RECAPTCHA_SITE_KEY,
            callback: (token: string) => {
              setCaptchaVerified(true);
              setShowCaptcha(false);
              if (pendingMessage) {
                doSendMessage(pendingMessage, token);
                setPendingMessage(null);
              }
            },
            theme: "dark",
            size: "normal",
          });
        }
      };
    };

    const timer = setTimeout(loadRecaptcha, 100);
    return () => clearTimeout(timer);
  }, [showCaptcha, pendingMessage]);

  const doSendMessage = async (text: string, captchaToken?: string) => {
    const userMsg: Message = { role: "user", content: text.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setIsLoading(true);

    try {
      const res = await fetch("/api/site-assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages,
          captchaToken: captchaToken || undefined,
        }),
      });

      if (res.status === 429) {
        const data = await res.json();
        if (data.requiresCaptcha) {
          setShowCaptcha(true);
          setPendingMessage(null);
          setMessages(prev => [...prev, {
            role: "assistant",
            content: "You've reached the free inquiry limit. Please complete the verification below to continue chatting."
          }]);
          setIsLoading(false);
          return;
        }
      }

      if (!res.ok) throw new Error("Failed to get response");

      const data = await res.json();
      setMessages(prev => [...prev, { role: "assistant", content: data.reply }]);
      setInquiryCount(prev => prev + 1);
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "Sorry, I couldn't process that request. Please try again." }]);
    } finally {
      setIsLoading(false);
    }
  };

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isLoading) return;

    const nextCount = inquiryCount + 1;

    if (nextCount > FREE_INQUIRY_LIMIT && !captchaVerified) {
      setPendingMessage(text.trim());
      setShowCaptcha(true);
      return;
    }

    doSendMessage(text);
  }, [isLoading, inquiryCount, captchaVerified, messages]);

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

  const remainingFree = Math.max(0, FREE_INQUIRY_LIMIT - inquiryCount);

  return (
    <>
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 z-50 bg-gradient-to-r from-[#F97316] to-[#EA580C] text-white rounded-full p-4 shadow-2xl shadow-orange-500/30 hover:scale-105 transition-transform group"
          data-testid="button-open-site-chat"
        >
          <div className="relative">
            <MessageCircle className="h-6 w-6" />
            <Sparkles className="h-3 w-3 absolute -top-1 -right-1 text-yellow-300 animate-pulse" />
          </div>
          <span className="absolute bottom-full right-0 mb-2 px-3 py-1.5 bg-black/90 text-white text-xs rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
            Ask the ConstructHUB Assistant
          </span>
        </button>
      )}

      {isOpen && (
        <div className="fixed bottom-6 right-6 z-50 w-[400px] max-w-[calc(100vw-2rem)] h-[600px] max-h-[calc(100vh-6rem)] flex flex-col rounded-2xl overflow-hidden shadow-2xl shadow-black/50 border border-white/[0.1]" data-testid="site-chat-window">
          <div className="bg-gradient-to-r from-[#F97316] to-[#EA580C] px-4 py-3 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="bg-white/20 rounded-full p-1.5">
                <Bot className="h-4 w-4 text-white" />
              </div>
              <div>
                <h3 className="text-white font-bold text-sm leading-tight">ConstructHUB Assistant</h3>
                <p className="text-white/70 text-[10px]">Ask anything about our platform</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {!captchaVerified && (
                <Badge className="bg-white/20 text-white border-0 text-[10px] px-1.5 py-0" data-testid="badge-remaining-inquiries">
                  {remainingFree} free
                </Badge>
              )}
              <Badge className="bg-white/20 text-white border-0 text-[10px] px-1.5 py-0">AI</Badge>
              <button
                onClick={() => setIsOpen(false)}
                className="text-white/70 hover:text-white p-1 rounded-md hover:bg-white/10 transition-colors"
                data-testid="button-close-site-chat"
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
                      Hi! I'm your ConstructHUB assistant. I can answer questions about our permit databases, Google Business tools, Click Guard, VPN Shield, pricing, and everything else on the platform. What would you like to know?
                    </p>
                  </div>
                </div>

                <div className="pl-9">
                  <p className="text-white/30 text-[11px] uppercase tracking-wider font-medium mb-2">Popular questions</p>
                  <div className="flex flex-wrap gap-1.5">
                    {QUICK_QUESTIONS.map((q, i) => (
                      <button
                        key={i}
                        onClick={() => sendMessage(q)}
                        className="text-xs bg-white/[0.05] border border-white/[0.1] text-white/60 hover:text-white hover:bg-white/[0.1] rounded-lg px-2.5 py-1.5 transition-colors text-left"
                        data-testid={`button-site-quick-question-${i}`}
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
                <div className={`rounded-full p-1.5 flex-shrink-0 mt-0.5 ${msg.role === "user" ? "bg-orange-500/20" : "bg-orange-500/20"}`}>
                  {msg.role === "user" ? (
                    <User className="h-3.5 w-3.5 text-orange-400" />
                  ) : (
                    <Bot className="h-3.5 w-3.5 text-orange-400" />
                  )}
                </div>
                <div className={`rounded-xl px-3.5 py-2.5 max-w-[85%] text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-orange-500/20 border border-orange-500/20 text-white/90 rounded-tr-sm"
                    : "bg-white/[0.05] border border-white/[0.08] text-white/70 rounded-tl-sm"
                }`} data-testid={`site-message-${msg.role}-${i}`}>
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

            {showCaptcha && (
              <div className="flex flex-col items-center gap-3 py-4">
                <div className="flex items-center gap-2 text-white/50 text-xs">
                  <ShieldCheck className="h-4 w-4" />
                  <span>Please verify you're human to continue</span>
                </div>
                <div ref={captchaContainerRef} data-testid="captcha-container" />
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          <div className="flex-shrink-0 bg-[#0d1117] border-t border-white/[0.08]">
            {!captchaVerified && inquiryCount > 0 && inquiryCount < FREE_INQUIRY_LIMIT && (
              <div className="px-3 pt-2 flex items-center gap-1.5">
                <Lock className="h-3 w-3 text-white/20" />
                <span className="text-[10px] text-white/20">
                  {remainingFree} free {remainingFree === 1 ? "question" : "questions"} remaining
                </span>
              </div>
            )}
            <form onSubmit={handleSubmit} className="px-3 py-3">
              <div className="flex items-center gap-2">
                <Input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask about ConstructHUB..."
                  disabled={isLoading || showCaptcha}
                  className="bg-white/[0.05] border-white/[0.1] text-white text-sm placeholder:text-white/30 focus-visible:ring-orange-500/50"
                  data-testid="input-site-chat-message"
                />
                <Button
                  type="submit"
                  size="sm"
                  disabled={!input.trim() || isLoading || showCaptcha}
                  className="bg-[#F97316] hover:bg-[#EA580C] text-white px-3 flex-shrink-0"
                  data-testid="button-send-site-message"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
