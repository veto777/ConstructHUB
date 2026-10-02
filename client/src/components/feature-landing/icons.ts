/**
 * Content files name icons as plain strings (shared/feature-pages/types.ts
 * FEATURE_ICONS); this maps each one to its lucide icon. The Record type makes
 * a name without an icon a compile error.
 */
import {
  AlertTriangle, Bell, BookOpen, Bot, Building2, CalendarDays, Camera, BarChart3, CheckCircle2, ClipboardList, Clock3, FileText,
  Cloud, Code2, Database, Download, Eye, Filter, Fingerprint, FolderOpen, Gauge, Globe, GraduationCap, Grid3X3,
  HardHat, History, Image as ImageIcon, Inbox, KanbanSquare, KeyRound, Layers, Link2, List, Lock, Mail, Map as MapIcon, MapPin, Megaphone,
  MessageSquare, Phone, Receipt, RefreshCw, Search, Send, Settings2, Share2, Shield, ShieldAlert, ShieldCheck, ShieldOff,
  Sparkles, Star, Tag, Target, TrendingUp, Users, Wallet, Wrench, Zap, type LucideIcon,
} from "lucide-react";
import type { FeatureIcon } from "@shared/feature-pages/types";

export const FEATURE_ICON_COMPONENTS: Record<FeatureIcon, LucideIcon> = {
  alert: AlertTriangle, bell: Bell, book: BookOpen, bot: Bot, building: Building2, calendar: CalendarDays, camera: Camera,
  chart: BarChart3, check: CheckCircle2, clipboard: ClipboardList, clock: Clock3, cloud: Cloud, code: Code2,
  database: Database, download: Download, eye: Eye, file: FileText, filter: Filter, fingerprint: Fingerprint,
  folder: FolderOpen, gauge: Gauge, globe: Globe, graduation: GraduationCap, grid: Grid3X3, "hard-hat": HardHat,
  history: History, image: ImageIcon, inbox: Inbox, kanban: KanbanSquare, key: KeyRound, layers: Layers, link: Link2,
  list: List, lock: Lock, mail: Mail, map: MapIcon, "map-pin": MapPin, megaphone: Megaphone, message: MessageSquare,
  phone: Phone, receipt: Receipt, refresh: RefreshCw, search: Search, send: Send, settings: Settings2, share: Share2,
  shield: Shield, "shield-alert": ShieldAlert, "shield-check": ShieldCheck, "shield-off": ShieldOff, sparkles: Sparkles,
  star: Star, tag: Tag, target: Target, "trending-up": TrendingUp, users: Users, wallet: Wallet, wrench: Wrench, zap: Zap,
};
