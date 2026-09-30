import { useRef, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Database, Zap, Globe, Target, MapPin, ChevronRight, Crown, Award,
} from "lucide-react";
import { GROWTH_TOOLS } from "@/lib/growth-tools";
import { formatCount, usePermitDirectoryCounts } from "@/lib/marketing";

function FloatingParticles({ color = "#d4d4d8" }: { color?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let animId: number;
    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    resize();
    window.addEventListener("resize", resize);
    const particles: { x: number; y: number; size: number; speedX: number; speedY: number; opacity: number; rotation: number; rotSpeed: number }[] = [];
    for (let i = 0; i < 60; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        size: Math.random() * 6 + 2,
        speedX: (Math.random() - 0.5) * 0.3,
        speedY: Math.random() * 0.25 + 0.08,
        opacity: Math.random() * 0.12 + 0.03,
        rotation: Math.random() * 360,
        rotSpeed: (Math.random() - 0.5) * 1.2,
      });
    }
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of particles) {
        p.x += p.speedX;
        p.y += p.speedY;
        p.rotation += p.rotSpeed;
        if (p.y > canvas.height + 10) { p.y = -10; p.x = Math.random() * canvas.width; }
        if (p.x < -10) p.x = canvas.width + 10;
        if (p.x > canvas.width + 10) p.x = -10;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.globalAlpha = p.opacity;
        ctx.fillStyle = color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      }
      animId = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(animId); window.removeEventListener("resize", resize); };
  }, [color]);
  return <canvas ref={canvasRef} className="fixed inset-0 pointer-events-none z-0" />;
}

export default function HomePage() {
  const [, setLocation] = useLocation();
  const { data: counts } = usePermitDirectoryCounts();
  const toolCount = GROWTH_TOOLS.length;
  // Directory numbers come from the database; "—" until they load (never a guess).
  const count = (n: number | undefined) => (typeof n === "number" ? formatCount(n) : "—");

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-12 relative">
      <FloatingParticles color="#c2410c" />
      <div className="text-center space-y-4 relative z-10">
        <Badge className="px-4 py-1.5 text-sm bg-orange-500/10 text-foreground dark:text-orange-400 border border-orange-500/20" data-testid="badge-home-hero">
          <Zap className="w-4 h-4 mr-2" /> Built for Contractors Who Refuse to Stay Small
        </Badge>
        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight leading-tight" data-testid="text-home-title">
          Stop Guessing. Start
          <span className="font-black italic text-[#F97316]"> Dominating.</span>
        </h1>
        <p className="text-muted-foreground max-w-3xl mx-auto text-lg leading-relaxed">
          Most contractors are leaving money on the table — chasing cold leads, getting ripped off by ad agencies, and watching competitors steal their jobs. ConstructHUB's expert-led Master Class and powerful growth tools give you the training, data, and protection to take control of your market.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 relative z-10">
        {[
          { label: "Jurisdictions Listed", value: count(counts?.total), icon: Database },
          typeof counts?.verifiedPortals === "number"
            ? { label: "Verified Portal Links", value: count(counts.verifiedPortals), icon: MapPin }
            : { label: "County Offices Listed", value: count(counts?.county), icon: MapPin },
          { label: "All 50 States + DC", value: "51", icon: Globe },
          { label: "Pro Tools", value: String(toolCount), icon: Zap },
        ].map((stat) => (
          <Card key={stat.label} className="bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800/50" data-testid={`card-stat-${stat.label.toLowerCase().replace(/\s+/g, "-")}`}>
            <CardContent className="p-4 text-center">
              <stat.icon className="w-6 h-6 mx-auto mb-2 text-blue-600 dark:text-blue-400" />
              <div className="text-2xl sm:text-3xl font-extrabold">{stat.value}</div>
              <div className="text-xs text-muted-foreground mt-1">{stat.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="space-y-6 relative z-10">
        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <h2 className="text-xl font-bold bg-gradient-to-r from-[#4A6CF7] to-[#F97316] bg-clip-text text-transparent whitespace-nowrap" data-testid="text-tools-heading">Your Complete Toolkit</h2>
          <div className="h-px flex-1 bg-border" />
        </div>

        <div className="space-y-5">
          {GROWTH_TOOLS.map((tool, index) => (
            <Link key={tool.title} href={tool.url} className="block no-underline" data-testid={`card-tool-${index}`}>
            <Card
              className="group border-border/50 hover:border-border transition-all hover:shadow-md cursor-pointer"
            >
              <CardContent className="p-0">
                <div className="flex flex-col lg:flex-row">
                  <div className="flex-1 p-6 space-y-3">
                    <div className="flex items-start gap-3">
                      <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 bg-muted border border-border/50">
                        <tool.icon className="w-6 h-6 text-[#4A6CF7]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-lg font-bold">{tool.title}</h3>
                          {tool.stats && (
                            <Badge variant="outline" className="text-[10px] text-muted-foreground">
                              {tool.stats}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm font-semibold text-[#4A6CF7]">{tool.tagline}</p>
                      </div>
                      <ChevronRight className="w-5 h-5 text-muted-foreground/40 group-hover:text-foreground transition-colors shrink-0 mt-1 hidden sm:block" />
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed">{tool.description}</p>
                  </div>

                  <div className="lg:w-[380px] shrink-0 p-5 lg:p-6 border-t lg:border-t-0 lg:border-l border-border/30 bg-muted/30 rounded-b-xl lg:rounded-b-none lg:rounded-r-xl">
                    <div className="flex items-start gap-2">
                      <Target className="w-4 h-4 shrink-0 mt-0.5 text-muted-foreground" />
                      <div>
                        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Why This Is a Game Changer</span>
                        <p className="text-sm mt-1 leading-relaxed">{tool.whyItMatters}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
            </Link>
          ))}
        </div>
      </div>

      <Card className="border-border/50 relative z-10" data-testid="card-bottom-cta">
        <CardContent className="p-8 text-center space-y-4">
          <Award className="w-10 h-10 text-muted-foreground mx-auto" />
          <h2 className="text-2xl font-extrabold">Ready to Get the Advantage?</h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Plans start at $15/month, with more of these {toolCount} tools unlocked on each tier —
            or go all-in with our Gold and Platinum plans for complete market domination.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <Button
              className="bg-foreground text-background hover:bg-foreground/90 font-bold px-8"
              onClick={() => setLocation("/pricing")}
              data-testid="button-view-plans"
            >
              <Crown className="w-4 h-4 mr-2" /> View Plans & Pricing
            </Button>
            <Button
              variant="outline"
              onClick={() => setLocation("/individual-pricing")}
              data-testid="button-individual-tools"
            >
              <Zap className="w-4 h-4 mr-2" /> À La Carte Tools
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
