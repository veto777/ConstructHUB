/**
 * Module 2 — GMB Setup & Optimization: the Google Business Profile lessons of the Master Class
 * (/master-class?tab=gmb). Opened by the GMB Setup & Optimization module, the bundle or an included course
 * (server/state-guides.ts). This file is the public outline — titles and icons; the lesson bodies are served by
 * /api/master-class/lessons/gmb (server/master-class/content/gmb.ts) to an entitled account only.
 */
import { BadgeCheck, Camera, Grid3x3, LifeBuoy, MapPin, Newspaper, ShieldAlert, Star, Store } from "lucide-react";
import type { ModuleHomeProps } from "./module-home";
import { ModuleHome } from "./module-home";
import type { LessonMeta } from "./lesson";
import { UnlockBadge } from "./gate";

const KEY = "mc:gmb";

export const GMB_LESSONS: LessonMeta[] = [
  { id: "setup", title: "Claim, verify and set up the profile", icon: BadgeCheck },
  { id: "info", title: "Business information that matches everywhere", icon: MapPin },
  { id: "photos", title: "A photo strategy that shows the work", icon: Camera },
  { id: "reviews", title: "Reviews: asking the right way, answering every one", icon: Star },
  { id: "defense", title: "Fake reviews and competitor attacks", icon: ShieldAlert },
  { id: "posts", title: "Posting cadence and a content calendar", icon: Newspaper },
  { id: "suspension", title: "Suspension prevention and recovery", icon: LifeBuoy },
  { id: "measure", title: "Measuring where you rank", icon: Grid3x3 },
];

export function GmbModule(p: ModuleHomeProps) {
  const unlocked = p.access?.unlocked.gmb === true;
  return (
    <ModuleHome {...p} title="GMB Setup & Optimization" icon={Store} unlocked={unlocked} lessons={GMB_LESSONS} lessonsModule="gmb" storageKey={KEY}
      what="The Google Business Profile lessons" moduleTitle="GMB Setup & Optimization" badge={<UnlockBadge access={p.access} category="gmb" />}
      description="A Google Business Profile that earns the map-pack spot and survives what competitors and Google throw at it: setup, photos, reviews, posts, suspensions and how to measure it." testId="module-gmb" />
  );
}
