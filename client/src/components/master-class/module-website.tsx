/**
 * Module 3 — Website & Online Presence: the website lessons of the Master Class (/master-class?tab=website).
 * Opened by the Website & Online Presence module, the bundle or an included course (server/state-guides.ts).
 * This file is the public outline — titles and icons; the lesson bodies are served by
 * /api/master-class/lessons/website (server/master-class/content/website.ts) to an entitled account only.
 */
import { Camera, Code, Gauge, Globe, Layers, Mail, Monitor, Smartphone } from "lucide-react";
import type { ModuleHomeProps } from "./module-home";
import { ModuleHome } from "./module-home";
import type { LessonMeta } from "./lesson";
import { UnlockBadge } from "./gate";

const KEY = "mc:website";

export const WEBSITE_LESSONS: LessonMeta[] = [
  { id: "blueprint", title: "The contractor website blueprint", icon: Layers },
  { id: "location-pages", title: "Location Pages & Slug Pages", icon: Globe },
  { id: "page-speed", title: "Page Speed & Performance", icon: Gauge },
  { id: "mobile", title: "Mobile-First Design & User Experience", icon: Smartphone },
  { id: "portfolio", title: "Portfolio showcases that close jobs", icon: Camera },
  { id: "schema", title: "Schema Markup & Structured Data", icon: Code },
  { id: "cms-hosting", title: "CMS, hosting and owning your site", icon: Monitor },
  { id: "email", title: "Email Marketing & Follow-Up Systems", icon: Mail },
];

export function WebsiteModule(p: ModuleHomeProps) {
  const unlocked = p.access?.unlocked.website === true;
  return (
    <ModuleHome {...p} title="Website & Online Presence" icon={Monitor} unlocked={unlocked} lessons={WEBSITE_LESSONS} lessonsModule="website" storageKey={KEY}
      what="The website lessons" moduleTitle="Website & Online Presence" badge={<UnlockBadge access={p.access} category="website" />}
      description="Build a contractor website that turns visitors into booked jobs: the pages it needs, how they rank, how fast they load and how they convert." testId="module-website" />
  );
}
