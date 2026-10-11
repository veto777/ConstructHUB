/**
 * Module 4 — SEO & Directory Domination: the local-SEO, citation, content, link-building and advertising lessons
 * of the Master Class (/master-class?tab=seo). Opened by the SEO & Directory Domination module, the bundle or an
 * included course (server/state-guides.ts). This file is the public outline — titles and icons — plus the
 * services inquiry form; the lesson bodies (including the monthly maintenance checklist) are served by
 * /api/master-class/lessons/seo (server/master-class/content/seo.ts) to an entitled account only.
 *
 * The services inquiry form at the end posts to /api/seo-inquiry like the sales dialog does.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { BarChart3, ClipboardList, FileSearch, Link2, ListChecks, Loader2, Megaphone, PenTool, Send, Share2, TrendingUp } from "lucide-react";
import { Section } from "@/components/app-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage, apiRequest } from "@/lib/queryClient";
import type { ModuleHomeProps } from "./module-home";
import { ModuleHome } from "./module-home";
import type { LessonMeta } from "./lesson";
import { UnlockBadge } from "./gate";

const KEY = "mc:seo";
/** Same shape the server's email check accepts (name@domain.tld). */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const SEO_LESSONS: LessonMeta[] = [
  { id: "search-console", title: "Google Search Console (GSC)", icon: FileSearch },
  { id: "tracking", title: "Tracking & Analytics", icon: BarChart3 },
  { id: "content", title: "Content Strategy That Actually Ranks", icon: PenTool },
  { id: "backlinks", title: "Backlinks & Link Building", icon: Link2 },
  { id: "citations", title: "Citations and directories", icon: ListChecks },
  { id: "social", title: "Social Media & Reputation Building", icon: Share2 },
  { id: "ads", title: "Google Ads & Local Service Ads (LSA)", icon: Megaphone },
  { id: "maintenance", title: "The monthly SEO maintenance checklist", icon: ClipboardList },
];

export function SeoModule(p: ModuleHomeProps) {
  const unlocked = p.access?.unlocked.seo === true;
  const { toast } = useToast();
  const [seoName, setSeoName] = useState("");
  const [seoEmail, setSeoEmail] = useState("");
  const [seoPhone, setSeoPhone] = useState("");
  const [seoWebsite, setSeoWebsite] = useState("");
  const [seoServices, setSeoServices] = useState<string[]>([]);
  const [seoMessage, setSeoMessage] = useState("");

  const seoInquiryMutation = useMutation({
    mutationFn: async (data: { name: string; email: string; phone: string; website: string; services: string[]; message: string }) => {
      const res = await apiRequest("POST", "/api/seo-inquiry", data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Inquiry sent", description: "We'll be in touch within 1 business day." });
      setSeoName(""); setSeoEmail(""); setSeoPhone(""); setSeoWebsite(""); setSeoServices([]); setSeoMessage("");
    },
    onError: (err: Error) => {
      toast({ title: "Failed to send", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  // A real <form>: the browser checks type="email" first, then this catches
  // what it lets through (e.g. "name@host" with no domain ending).
  const submitSeoInquiry = (e: React.FormEvent) => {
    e.preventDefault();
    if (!EMAIL_PATTERN.test(seoEmail.trim())) {
      toast({ title: "Check your email", description: "Enter a valid email address", variant: "destructive" });
      return;
    }
    seoInquiryMutation.mutate({ name: seoName, email: seoEmail, phone: seoPhone, website: seoWebsite, services: seoServices, message: seoMessage });
  };

  const toggleSeoService = (service: string) => {
    setSeoServices(prev => prev.includes(service) ? prev.filter(s => s !== service) : [...prev, service]);
  };

  return (
    <ModuleHome {...p} title="SEO & Directory Domination" icon={TrendingUp} unlocked={unlocked} lessons={SEO_LESSONS} lessonsModule="seo" storageKey={KEY}
      what="The SEO and advertising lessons" moduleTitle="SEO & Directory Domination" badge={<UnlockBadge access={p.access} category="seo" />}
      description="Get found everywhere your customers search: Search Console, tracking, content, links, citations, social, paid ads and the monthly routine that keeps it all working." testId="module-seo">

    <Section flush className="border-border   ">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Send className="h-5 w-5 text-muted-foreground" />
          Need Help With Any of These Services?
        </CardTitle>
        <CardDescription>
          Whether you need help with link building, SEO audits, page speed optimization, Google Search Console setup, or content creation — we offer all of these services. Fill out the form below and we'll get back to you.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={submitSeoInquiry} data-testid="form-seo-inquiry">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="seo-name">Full Name</Label>
            <Input id="seo-name" placeholder="Your name" value={seoName} onChange={(e) => setSeoName(e.target.value)} data-testid="input-seo-name" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="seo-email">Email</Label>
            <Input id="seo-email" type="email" required placeholder="you@company.com" value={seoEmail} onChange={(e) => setSeoEmail(e.target.value)} data-testid="input-seo-email" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="seo-phone">Phone</Label>
            <Input id="seo-phone" type="tel" placeholder="(555) 123-4567" value={seoPhone} onChange={(e) => setSeoPhone(e.target.value)} data-testid="input-seo-phone" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="seo-website">Website URL</Label>
            <Input id="seo-website" placeholder="https://yoursite.com" value={seoWebsite} onChange={(e) => setSeoWebsite(e.target.value)} data-testid="input-seo-website" />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Services Interested In</Label>
          <div className="flex flex-wrap gap-2">
            {[
              "Link Building", "Guest Posts", "Press Releases / PBNs", "SEO Audit",
              "Page Speed Optimization", "Google Search Console Setup", "Google Analytics Setup",
              "Content Writing", "Website Design", "Local SEO", "Backlink Cleanup"
            ].map(service => (
              <Badge
                key={service}
                variant={seoServices.includes(service) ? "default" : "outline"}
                className={`cursor-pointer transition-colors ${seoServices.includes(service) ? "bg-muted" : "hover:bg-muted"}`}
                onClick={() => toggleSeoService(service)}
                data-testid={`badge-service-${service.toLowerCase().replace(/\s+/g, "-")}`}
              >
                {service}
              </Badge>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="seo-message">Tell Us About Your Project</Label>
          <Textarea
            id="seo-message"
            placeholder="Describe what you need help with, your current situation, goals, and any specific concerns..."
            value={seoMessage}
            onChange={(e) => setSeoMessage(e.target.value)}
            rows={4}
            data-testid="textarea-seo-message"
          />
        </div>

        <Button
          type="submit"
          className="w-full sm:w-auto"
          data-testid="button-submit-seo-inquiry"
          disabled={seoInquiryMutation.isPending || !seoName.trim() || !seoEmail.trim()}
        >
          {seoInquiryMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
          Submit inquiry
        </Button>
        </form>
      </CardContent>
    </Section>
    </ModuleHome>
  );
}
