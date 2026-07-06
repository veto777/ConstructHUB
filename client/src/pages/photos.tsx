import { useState, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Camera,
  Download,
  Upload,
  Wand2,
  Image,
  Settings,
  Sparkles,
  ChevronDown,
  ChevronUp,
  X,
  Loader2,
  Check,
  FileImage,
  Trash2,
  Search,
  MapPin,
  Building2,
  Save,
  FolderOpen,
  MoreVertical,
  Pencil,
  ExternalLink,
  Plus,
  Maximize2,
  FlipHorizontal,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GBP_CATEGORIES } from "@/data/gbp-categories";

const GENERIC_SUFFIXES = [
  "Exteriors", "Installer", "Installers", "Installation", "Contractor", "Contractors",
  "Company", "Companies", "Services", "Specialists", "Pros", "Experts", "Near Me", "Near You",
];
const expandKeywords = (base: string, extras: string[]): string[] => {
  const variants = GENERIC_SUFFIXES.map(s => `${base} ${s}`);
  return [...variants, ...extras];
};

const MODIFIER_CATEGORIES = ["Residential", "Commercial", "Multifamily", "Apartments"] as const;
const MODIFIER_LABELS: Record<string, string> = {
  Residential: "Residential",
  Commercial: "Commercial",
  Multifamily: "Multifamily",
  Apartments: "Apartment",
};

const categoryKeywords: Record<string, string[]> = {
  Roofing: expandKeywords("Roofing", [
    "Roofers Near Me", "Roof Replacement", "Emergency Roof Repair",
    "Roof Leak Repair", "GAF Roofing Contractor",
    "GAF Timberline Roofing", "GAF Timberline HDZ Roofing", "GAF HDZ Roofing Contractor",
    "Certified GAF Roofing Contractor",
  ]),
  Residential: expandKeywords("Residential", [
    "Residential Construction", "Residential Remodeling", "Residential Renovation",
    "Residential Home Improvement",
  ]),
  Commercial: expandKeywords("Commercial", [
    "Commercial Construction", "Commercial Remodeling", "Commercial Renovation",
    "Commercial Property Maintenance",
  ]),
  Multifamily: expandKeywords("Multifamily", [
    "Multifamily Construction", "Multifamily Renovation",
    "Multifamily Property Maintenance", "Multifamily Exterior Restoration",
  ]),
  Apartments: expandKeywords("Apartments", [
    "Apartment Complex Contractor", "Apartment Renovation",
    "Apartment Building Maintenance", "Apartment Exterior Restoration",
  ]),
  Exteriors: expandKeywords("Exteriors", [
    "Exterior Remodeling", "Exterior Restoration", "Home Exteriors Contractor",
    "Residential Exteriors", "Commercial Exteriors",
  ]),
  Brick: expandKeywords("Brick", [
    "Brick Mason", "Brick Masonry Contractor", "Brick Repair", "Brick Restoration",
    "Brick Pointing", "Tuckpointing Contractor", "Brick Veneer Installation",
  ]),
  Siding: expandKeywords("Siding", [
    "Vinyl Siding Installation", "James Hardie Siding", "Fiber Cement Siding",
    "Siding Replacement", "Siding Repair Contractor", "Board and Batten Siding",
  ]),
  Windows: expandKeywords("Windows", [
    "Window Replacement Contractor", "Window Installation Near Me",
    "Energy Efficient Windows", "Vinyl Window Installation",
    "Double Pane Window Installer",
  ]),
  Gutters: expandKeywords("Gutters", [
    "Gutter Installation Near Me", "Seamless Gutters Contractor",
    "Gutter Replacement", "Gutter Guard Installation", "Rain Gutter Contractor",
  ]),
  Painting: expandKeywords("Painting", [
    "Exterior Painting Contractor", "House Painting Near Me",
    "Commercial Painting Contractor", "Residential Painter",
    "Cabinet Painting", "Interior Painting",
  ]),
  Decking: expandKeywords("Decking", [
    "Deck Builder Near Me", "Composite Deck Contractor", "Trex Deck Installer",
    "Deck Replacement Contractor", "Custom Deck Builder",
  ]),
  "General Contractor": expandKeywords("General Contracting", [
    "General Contractor Near Me", "Home Renovation Contractor",
    "Licensed General Contractor", "Remodeling Contractor",
    "Home Improvement Contractor",
  ]),
  Fascia: expandKeywords("Fascia", [
    "Fascia Board Replacement", "Fascia Repair", "Rotted Fascia Repair",
    "Aluminum Fascia Installation", "Wood Fascia Replacement",
  ]),
  Soffits: expandKeywords("Soffits", [
    "Soffit Installation", "Soffit Repair", "Vented Soffit Installation",
    "Aluminum Soffit Installation", "Vinyl Soffit Replacement",
    "Soffit and Fascia Contractor",
  ]),
};

interface BusinessInfo {
  companyName: string;
  phone: string;
  address: string;
  city: string;
  countyState: string;
  website: string;
  services: string;
  copyright: string;
  lat?: number | null;
  lon?: number | null;
}

interface UploadedFile {
  id: string;
  file: File;
  preview: string;
  name: string;
}

interface ProcessedFile {
  fileId: string;
  processedId: string;
  fileName: string;
}

const defaultBusiness: BusinessInfo = {
  companyName: "",
  phone: "",
  address: "",
  city: "",
  countyState: "",
  website: "",
  services: "",
  copyright: "",
};

interface PhotoTemplate {
  id: string;
  name: string;
  businessInfo: BusinessInfo;
  category: string;
  selectedKeywords: string[];
  watermarkEnabled: boolean;
  watermarkText: string;
  watermarkType: "text" | "image";
  watermarkOpacity: number;
  createdAt: number;
}

function loadBusinessInfo(): BusinessInfo {
  try {
    const saved = localStorage.getItem("gmb-business-info");
    if (saved) return { ...defaultBusiness, ...JSON.parse(saved) };
  } catch {}
  return defaultBusiness;
}

function loadTemplates(): PhotoTemplate[] {
  try {
    const saved = localStorage.getItem("gmb-photo-templates");
    if (saved) return JSON.parse(saved);
  } catch {}
  return [];
}

function saveTemplates(templates: PhotoTemplate[]) {
  localStorage.setItem("gmb-photo-templates", JSON.stringify(templates));
}

export default function PhotosPage() {
  const { toast } = useToast();

  const { data: savedLocations } = useQuery<any[]>({
    queryKey: ["/api/locations"],
  });

  const [businessInfo, setBusinessInfo] = useState<BusinessInfo>(loadBusinessInfo);
  const [businessCollapsed, setBusinessCollapsed] = useState(true);

  const [businessQuery, setBusinessQuery] = useState("");
  const [businessResults, setBusinessResults] = useState<any[]>([]);
  const [businessSearching, setBusinessSearching] = useState(false);
  const [businessNextPageToken, setBusinessNextPageToken] = useState<string | null>(null);
  const [businessLoadingMore, setBusinessLoadingMore] = useState(false);

  const [categories, setCategories] = useState<string[]>([]);
  const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(false);
  const [categorySearch, setCategorySearch] = useState("");
  const [selectedKeywords, setSelectedKeywords] = useState<Set<string>>(new Set());

  const [serviceAreaEnabled, setServiceAreaEnabled] = useState<boolean>(false);
  const [serviceAreaRadius, setServiceAreaRadius] = useState<number>(10);
  const [serviceAreaTypes, setServiceAreaTypes] = useState<Set<string>>(new Set(["locality"]));
  const [serviceAreaDensity, setServiceAreaDensity] = useState<"low" | "medium" | "high" | "max">("medium");
  const [serviceAreaNameFilter, setServiceAreaNameFilter] = useState<string>("");
  const [serviceAreaResults, setServiceAreaResults] = useState<{ name: string; state: string; distance: number }[]>([]);
  const [selectedServiceAreas, setSelectedServiceAreas] = useState<Set<string>>(new Set());
  const [serviceAreaLoading, setServiceAreaLoading] = useState(false);
  const [manualCityInput, setManualCityInput] = useState<string>("");

  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const categoryBtnRef = useRef<HTMLButtonElement>(null);

  const [watermarkEnabled, setWatermarkEnabled] = useState(true);
  const [watermarkText, setWatermarkText] = useState("");
  const [watermarkType, setWatermarkType] = useState<"text" | "image">("text");
  const [watermarkImageFile, setWatermarkImageFile] = useState<File | null>(null);
  const [watermarkImagePreview, setWatermarkImagePreview] = useState<string>("");
  const [watermarkImageId, setWatermarkImageId] = useState<string>("");
  const [watermarkOpacity, setWatermarkOpacity] = useState(0.85);
  const [mirrorPhotos, setMirrorPhotos] = useState(false);
  const watermarkInputRef = useRef<HTMLInputElement>(null);

  const [photoFilters, setPhotoFilters] = useState<Record<string, { brightness: number; contrast: number; saturation: number }>>({});
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);

  const [descriptions, setDescriptions] = useState<Record<string, string>>({});

  const [processedFiles, setProcessedFiles] = useState<ProcessedFile[]>([]);
  const processedRef = useRef<HTMLDivElement>(null);

  type SavedBatch = { id: string; savedAt: number; companyName: string; files: ProcessedFile[] };
  const RECENT_BATCHES_KEY = "constructhub_recent_photo_batches";
  const [recentBatches, setRecentBatches] = useState<SavedBatch[]>(() => {
    try {
      const raw = localStorage.getItem(RECENT_BATCHES_KEY);
      return raw ? (JSON.parse(raw) as SavedBatch[]) : [];
    } catch { return []; }
  });
  const persistRecentBatches = (batches: SavedBatch[]) => {
    setRecentBatches(batches);
    try { localStorage.setItem(RECENT_BATCHES_KEY, JSON.stringify(batches)); } catch {}
  };
  const [uploadedFileIds, setUploadedFileIds] = useState<string[]>([]);
  const [serverFileMap, setServerFileMap] = useState<Record<string, string>>({});
  const [enhancingPhotos, setEnhancingPhotos] = useState<Set<string>>(new Set());

  const [mediaFolders, setMediaFolders] = useState<{id: number; name: string}[]>([]);
  const [showSaveToLibrary, setShowSaveToLibrary] = useState(false);
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [savingToLibrary, setSavingToLibrary] = useState(false);

  const fetchFolders = useCallback(async () => {
    try {
      const res = await fetch("/api/media/folders", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setMediaFolders(data);
      }
    } catch {}
  }, []);

  const handleSaveToLibrary = async () => {
    if (!selectedFolderId && !newFolderName.trim()) {
      toast({ title: "Select or create a folder", variant: "destructive" });
      return;
    }
    setSavingToLibrary(true);
    try {
      let folderId = selectedFolderId;
      if (!folderId && newFolderName.trim()) {
        const res = await apiRequest("POST", "/api/media/folders", { name: newFolderName.trim() });
        const folder = await res.json();
        folderId = folder.id;
        setMediaFolders(prev => [folder, ...prev]);
        setNewFolderName("");
      }
      const res = await apiRequest("POST", "/api/media/save-processed", {
        folderId,
        files: processedFiles.map(f => ({ processedId: f.processedId, fileName: f.fileName })),
      });
      const data = await res.json();
      toast({ title: "Saved to Media Library", description: `${data.count} photo${data.count !== 1 ? "s" : ""} saved.` });
      setShowSaveToLibrary(false);
      setSelectedFolderId(null);
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    } finally {
      setSavingToLibrary(false);
    }
  };

  const [templates, setTemplates] = useState<PhotoTemplate[]>(loadTemplates);
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);

  const handleSaveTemplate = () => {
    const name = templateName.trim();
    if (!name) {
      toast({ title: "Enter a template name", variant: "destructive" });
      return;
    }
    const newTemplate: PhotoTemplate = {
      id: editingTemplateId || `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      businessInfo,
      category: categories.join(", "),
      selectedKeywords: Array.from(selectedKeywords),
      watermarkEnabled,
      watermarkText,
      watermarkType,
      watermarkOpacity,
      createdAt: Date.now(),
    };
    setTemplates(prev => {
      const updated = editingTemplateId
        ? prev.map(t => (t.id === editingTemplateId ? newTemplate : t))
        : [...prev, newTemplate];
      saveTemplates(updated);
      return updated;
    });
    setTemplateName("");
    setShowSaveTemplate(false);
    setEditingTemplateId(null);
    toast({ title: editingTemplateId ? "Template updated" : "Template saved", description: `"${name}" saved for quick use.` });
  };

  const loadTemplate = (tpl: PhotoTemplate) => {
    setBusinessInfo(tpl.businessInfo);
    setCategories(tpl.category ? tpl.category.split(", ").filter(Boolean) : []);
    setSelectedKeywords(new Set(tpl.selectedKeywords));
    setWatermarkEnabled(tpl.watermarkEnabled);
    setWatermarkText(tpl.watermarkText);
    setWatermarkType(tpl.watermarkType);
    setWatermarkOpacity(tpl.watermarkOpacity);
    setBusinessCollapsed(true);
    toast({ title: `"${tpl.name}" loaded`, description: "All settings applied from template." });
  };

  const deleteTemplate = (id: string) => {
    setTemplates(prev => {
      const updated = prev.filter(t => t.id !== id);
      saveTemplates(updated);
      return updated;
    });
    toast({ title: "Template deleted" });
  };

  const startEditTemplate = (tpl: PhotoTemplate) => {
    setEditingTemplateId(tpl.id);
    setTemplateName(tpl.name);
    setShowSaveTemplate(true);
  };

  useEffect(() => {
    localStorage.setItem("gmb-business-info", JSON.stringify(businessInfo));
  }, [businessInfo]);

  useEffect(() => {
    if (!watermarkText && businessInfo.companyName) {
      setWatermarkText(businessInfo.companyName);
    }
  }, [businessInfo.companyName]);

  const defaultFilters = { brightness: 1.0, contrast: 1.0, saturation: 1.0 };

  const getPhotoFilter = (id: string) => photoFilters[id] || defaultFilters;

  const updatePhotoFilter = (id: string, key: "brightness" | "contrast" | "saturation", value: number) => {
    setPhotoFilters(prev => ({
      ...prev,
      [id]: { ...(prev[id] || defaultFilters), [key]: value },
    }));
  };

  const resetPhotoFilter = (id: string) => {
    setPhotoFilters(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const applyFiltersToAll = (sourceId: string) => {
    const source = getPhotoFilter(sourceId);
    setPhotoFilters(prev => {
      const next = { ...prev };
      for (const file of uploadedFiles) {
        next[file.id] = { ...source };
      }
      return next;
    });
    toast({ title: "Filters applied to all photos" });
  };

  const getFilterStyle = (id: string) => {
    const f = getPhotoFilter(id);
    return { filter: `brightness(${f.brightness}) contrast(${f.contrast}) saturate(${f.saturation})` };
  };

  const compressImage = async (file: File, maxDim = 4096, quality = 0.92): Promise<Blob> => {
    if (file.size < 4 * 1024 * 1024) return file;

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsDataURL(file);
    });

    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Failed to load image"));
      image.src = dataUrl;
    });

    let { width, height } = img;
    if (width > maxDim || height > maxDim) {
      if (width > height) {
        height = Math.round((height / width) * maxDim);
        width = maxDim;
      } else {
        width = Math.round((width / height) * maxDim);
        height = maxDim;
      }
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, width, height);

    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob) return file;
    return blob.size < file.size ? blob : file;
  };

  const uploadSingleFile = async (localId: string): Promise<string> => {
    if (serverFileMap[localId]) return serverFileMap[localId];

    const file = uploadedFiles.find(f => f.id === localId);
    if (!file) throw new Error("File not found");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    try {
      let blobToUpload: Blob = file.file;
      try {
        blobToUpload = await compressImage(file.file);
      } catch {
        blobToUpload = file.file;
      }

      const fileName = file.file.name.replace(/\.(heic|heif|png|webp)$/i, ".jpg");
      const formData = new FormData();
      formData.append("photos", blobToUpload, fileName);
      const res = await fetch("/api/photos/upload", {
        method: "POST",
        body: formData,
        credentials: "include",
        signal: controller.signal,
      });
      if (!res.ok) {
        if (res.status === 413) throw new Error("Photo too large even after compression");
        throw new Error(`Upload failed (${res.status})`);
      }
      const data = await res.json();
      const serverId = data.files[0]?.id;
      if (!serverId) throw new Error("No file ID returned");

      setServerFileMap(prev => ({ ...prev, [localId]: serverId }));
      return serverId;
    } finally {
      clearTimeout(timeout);
    }
  };

  const autoEnhancePhoto = async (localId: string) => {
    setEnhancingPhotos(prev => new Set(prev).add(localId));
    try {
      const serverId = await uploadSingleFile(localId);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 90000);
      try {
        const res = await fetch("/api/photos/auto-enhance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileId: serverId }),
          credentials: "include",
          signal: controller.signal,
        });
        if (!res.ok) throw new Error("Enhance failed");
        const filters = await res.json();
        setPhotoFilters(prev => ({
          ...prev,
          [localId]: { brightness: filters.brightness, contrast: filters.contrast, saturation: filters.saturation },
        }));
      } finally {
        clearTimeout(timeout);
      }
    } catch (err: any) {
      if (err?.name === "AbortError") {
        toast({ title: "Enhancement timed out", description: "Photo took too long. Try again or adjust filters manually.", variant: "destructive" });
      } else {
        toast({ title: "Enhancement failed", description: "Could not analyze the photo.", variant: "destructive" });
      }
    } finally {
      setEnhancingPhotos(prev => {
        const next = new Set(prev);
        next.delete(localId);
        return next;
      });
    }
  };

  const addManualCities = () => {
    const raw = manualCityInput.trim();
    if (!raw) return;
    const stateFromBusiness = (() => {
      const cs = (businessInfo.countyState || "").trim();
      const m = cs.match(/\b([A-Z]{2})\b/);
      return m ? m[1] : "";
    })();
    const tokens = raw.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean);
    const parsed: { name: string; state: string }[] = [];
    let i = 0;
    while (i < tokens.length) {
      const t = tokens[i];
      const next = tokens[i + 1];
      if (next && /^[A-Za-z]{2}$/.test(next)) {
        parsed.push({ name: t, state: next.toUpperCase() });
        i += 2;
      } else {
        parsed.push({ name: t, state: stateFromBusiness });
        i += 1;
      }
    }
    if (parsed.length === 0) return;
    setServiceAreaResults(prev => {
      const seen = new Set(prev.map(r => `${r.name.toLowerCase()}|${r.state.toLowerCase()}`));
      const additions = parsed
        .filter(p => !seen.has(`${p.name.toLowerCase()}|${p.state.toLowerCase()}`))
        .map(p => ({ name: p.name, state: p.state, distance: 0 }));
      return [...prev, ...additions];
    });
    setSelectedServiceAreas(prev => {
      const next = new Set(prev);
      for (const p of parsed) next.add(p.state ? `${p.name}, ${p.state}` : p.name);
      return next;
    });
    setManualCityInput("");
    toast({ title: `Added ${parsed.length} ${parsed.length === 1 ? "city" : "cities"}`, description: parsed.map(p => p.state ? `${p.name}, ${p.state}` : p.name).join(", ") });
  };

  const autoEnhanceAll = async () => {
    const ids = uploadedFiles.map(f => f.id);
    const concurrency = 3;
    let cursor = 0;
    const workers = Array.from({ length: Math.min(concurrency, ids.length) }, async () => {
      while (cursor < ids.length) {
        const idx = cursor++;
        await autoEnhancePhoto(ids[idx]).catch(() => {});
      }
    });
    await Promise.all(workers);
  };

  const updateBusiness = (field: keyof BusinessInfo, value: string) => {
    setBusinessInfo(prev => {
      const updated = { ...prev, [field]: value };
      if (field === "address" || field === "city" || field === "countyState") {
        updated.lat = null;
        updated.lon = null;
      }
      return updated;
    });
  };

  const searchBusiness = async () => {
    if (!businessQuery.trim()) return;
    setBusinessSearching(true);
    setBusinessResults([]);
    setBusinessNextPageToken(null);
    try {
      const res = await apiRequest("POST", "/api/photos/business-search", { query: businessQuery });
      const data = await res.json();
      if (data.results && data.results.length > 0) {
        setBusinessResults(data.results);
        setBusinessNextPageToken(data.nextPageToken || null);
      } else {
        toast({ title: "No results found", description: "Google's business index doesn't have this name. Paste the business's Google Maps share link (maps.app.goo.gl/...) instead — that always works." });
      }
    } catch {
      toast({ title: "Search failed", description: "Could not look up business info. Try again.", variant: "destructive" });
    } finally {
      setBusinessSearching(false);
    }
  };

  const loadMoreBusinessResults = async () => {
    if (!businessNextPageToken || businessLoadingMore) return;
    setBusinessLoadingMore(true);
    try {
      const res = await apiRequest("POST", "/api/photos/business-search", { query: businessQuery, pageToken: businessNextPageToken });
      const data = await res.json();
      if (data.results && data.results.length > 0) {
        setBusinessResults(prev => [...prev, ...data.results]);
      }
      setBusinessNextPageToken(data.nextPageToken || null);
    } catch {
      toast({ title: "Failed to load more", description: "Try again.", variant: "destructive" });
    } finally {
      setBusinessLoadingMore(false);
    }
  };

  const selectBusinessResult = async (result: any) => {
    try {
      setBusinessSearching(true);
      if (!result.placeId) {
        setBusinessInfo(prev => ({
          ...prev,
          companyName: result.companyName || "",
          phone: result.phone || prev.phone,
          address: result.address || "",
          website: result.website || prev.website,
          services: result.category || prev.services,
          copyright: `\u00A9 ${new Date().getFullYear()} ${result.companyName || ""}`,
          lat: typeof result.lat === "number" ? result.lat : null,
          lon: typeof result.lon === "number" ? result.lon : null,
        }));
        if (result.companyName) setWatermarkText(result.companyName);
        setBusinessResults([]);
        setBusinessQuery("");
        setBusinessCollapsed(false);
        const filled: string[] = [];
        if (result.companyName) filled.push("name");
        if (result.phone) filled.push("phone");
        if (result.website) filled.push("website");
        if (result.address) filled.push("address");
        if (result.category) filled.push("category");
        const desc = result.serviceAreaBusiness
          ? `Filled in ${filled.join(", ")}. This is a service-area business — Google doesn't publish a street address, so leave Address blank or enter your office.`
          : result.needsManualAddress
            ? `Filled in ${filled.join(", ")}. Please add the address manually below.`
            : `Filled in ${filled.join(", ")}.`;
        toast({ title: "Business loaded", description: desc });
        return;
      }
      const res = await apiRequest("POST", "/api/photos/business-details", { placeId: result.placeId });
      const details = await res.json();
      setBusinessInfo({
        companyName: details.companyName || result.companyName || "",
        phone: details.phone || "",
        address: details.address || result.address || "",
        city: details.city || "",
        countyState: details.countyState || "",
        website: details.website || "",
        services: details.category || "",
        copyright: `\u00A9 ${new Date().getFullYear()} ${details.companyName || result.companyName || ""}`,
        lat: details.lat ?? null,
        lon: details.lon ?? null,
      });
      if (details.companyName || result.companyName) {
        setWatermarkText(details.companyName || result.companyName);
      }
      setBusinessResults([]);
      setBusinessQuery("");
      setBusinessCollapsed(false);
      toast({ title: "Business info loaded", description: `${details.companyName || result.companyName} details applied.` });
    } catch {
      toast({ title: "Failed to load details", description: "Try selecting again or enter manually.", variant: "destructive" });
    } finally {
      setBusinessSearching(false);
    }
  };

  const handleWatermarkImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    setWatermarkImageFile(file);
    setWatermarkImagePreview(URL.createObjectURL(file));

    const formData = new FormData();
    formData.append("watermark", file);
    try {
      const res = await fetch("/api/photos/upload-watermark", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();
      setWatermarkImageId(data.watermarkId);
      toast({ title: "Watermark uploaded", description: file.name });
    } catch {
      toast({ title: "Upload failed", description: "Could not upload watermark image.", variant: "destructive" });
      setWatermarkImageFile(null);
      setWatermarkImagePreview("");
    }
  };

  const removeWatermarkImage = () => {
    setWatermarkImageFile(null);
    setWatermarkImagePreview("");
    setWatermarkImageId("");
    setWatermarkType("text");
  };


  const [removedKeywords, setRemovedKeywords] = useState<Set<string>>(new Set());
  const [customKeywords, setCustomKeywords] = useState<string[]>([]);
  const [newCustomKeyword, setNewCustomKeyword] = useState("");
  const keywords = (() => {
    if (categories.length === 0) return [];
    const modifiers = categories.filter(c => (MODIFIER_CATEGORIES as readonly string[]).includes(c));
    const bases = categories.filter(c => !(MODIFIER_CATEGORIES as readonly string[]).includes(c));
    const result = new Set<string>();
    for (const cat of categories) {
      for (const kw of (categoryKeywords[cat] ?? [])) result.add(kw);
    }
    if (modifiers.length > 0 && bases.length > 0) {
      for (const mod of modifiers) {
        const label = MODIFIER_LABELS[mod] ?? mod;
        for (const base of bases) {
          for (const kw of (categoryKeywords[base] ?? [])) {
            if (kw.toLowerCase().startsWith(label.toLowerCase() + " ")) {
              result.add(kw);
            } else {
              result.add(`${label} ${kw}`);
            }
          }
        }
      }
    }
    return [...result].filter(kw => !removedKeywords.has(kw));
  })();
  const allKeywords = [...keywords, ...customKeywords];

  const toggleKeyword = (kw: string) => {
    setSelectedKeywords(prev => {
      const next = new Set(prev);
      if (next.has(kw)) next.delete(kw);
      else next.add(kw);
      return next;
    });
  };

  const selectAllKeywords = () => {
    setSelectedKeywords(new Set(allKeywords));
  };

  const addKeywordsFromInput = (raw: string) => {
    const parts = raw.split(/[,\n\t]+/).map(s => s.trim()).filter(Boolean);
    if (parts.length === 0) return;
    const fresh = parts.filter(kw => !allKeywords.includes(kw));
    if (fresh.length > 0) {
      setCustomKeywords(prev => [...prev, ...fresh.filter(kw => !prev.includes(kw))]);
    }
    setSelectedKeywords(prev => {
      const next = new Set(prev);
      parts.forEach(kw => next.add(kw));
      return next;
    });
    setNewCustomKeyword("");
  };

  const clearKeywords = () => {
    setSelectedKeywords(new Set());
  };

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter(f =>
      /\.(jpe?g|png)$/i.test(f.name)
    );
    addFiles(files);
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files).filter(f =>
        /\.(jpe?g|png)$/i.test(f.name)
      );
      addFiles(files);
      e.target.value = "";
    }
  }, []);

  const addFiles = (files: File[]) => {
    const newFiles: UploadedFile[] = files.map(file => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      file,
      preview: URL.createObjectURL(file),
      name: file.name,
    }));
    setUploadedFiles(prev => [...prev, ...newFiles]);
  };

  const removeFile = (id: string) => {
    setUploadedFiles(prev => {
      const file = prev.find(f => f.id === id);
      if (file) URL.revokeObjectURL(file.preview);
      return prev.filter(f => f.id !== id);
    });
    setDescriptions(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const clearAllFiles = () => {
    uploadedFiles.forEach(f => URL.revokeObjectURL(f.preview));
    setUploadedFiles([]);
    setDescriptions({});
    setProcessedFiles([]);
    setUploadedFileIds([]);
  };

  const uploadMutation = useMutation({
    mutationFn: async (files: File[]) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120000);
      try {
        const formData = new FormData();
        files.forEach(f => formData.append("photos", f));
        const res = await fetch("/api/photos/upload", {
          method: "POST",
          body: formData,
          credentials: "include",
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
      } finally {
        clearTimeout(timeout);
      }
    },
    onSuccess: (data) => {
      const ids = (data.files || []).map((f: any) => f.id);
      setUploadedFileIds(ids);
    },
    onError: (err: any) => {
      const msg = err?.name === "AbortError" ? "Upload timed out. Try fewer or smaller photos." : (err?.message || "Upload failed");
      toast({ title: "Upload failed", description: msg, variant: "destructive" });
    },
  });

  const [useAIDescriptions, setUseAIDescriptions] = useState(false);

  const descriptionMutation = useMutation({
    mutationFn: async ({ fileId, fileName }: { fileId: string; fileName: string }) => {
      const res = await apiRequest("POST", "/api/photos/generate-description", {
        city: businessInfo.city,
        county: businessInfo.countyState,
        keyword: Array.from(selectedKeywords)[0] || categories[0] || "",
        service: businessInfo.services || categories.join(", ") || "",
        companyName: businessInfo.companyName,
        website: businessInfo.website,
        fileName,
        useAI: useAIDescriptions,
      });
      return res.json();
    },
  });

  const processMutation = useMutation({
    mutationFn: async (payload: any) => {
      const startRes = await fetch("/api/photos/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include",
      });
      if (!startRes.ok) {
        const errData = await startRes.json().catch(() => ({ message: "Processing failed" }));
        throw new Error(errData.message || "Processing failed");
      }
      const { jobId, total } = await startRes.json();
      if (!jobId) throw new Error("Server did not return a job id");

      while (true) {
        await new Promise(r => setTimeout(r, 2000));
        const statusRes = await fetch(`/api/photos/process/${jobId}`, { credentials: "include" });
        if (!statusRes.ok) {
          throw new Error("Lost connection to processing job");
        }
        const job = await statusRes.json();
        setProcessingStep(`Processing photo ${job.processed} of ${job.total}...`);
        if (job.status === "error") {
          throw new Error(job.error || "Processing failed");
        }
        if (job.status === "done") {
          return { processed: job.results || [], errors: job.errors };
        }
      }
    },
    onSuccess: (data) => {
      const newFiles: ProcessedFile[] = (data.processed || []).map((p: any) => ({
        fileId: p.fileId,
        processedId: p.processedId,
        fileName: p.newName,
      }));
      setProcessedFiles(newFiles);
      if (newFiles.length > 0) {
        const batch: SavedBatch = {
          id: `${Date.now()}`,
          savedAt: Date.now(),
          companyName: businessInfo.companyName || "Untitled batch",
          files: newFiles,
        };
        const next = [batch, ...recentBatches.filter(b => b.id !== batch.id)].slice(0, 3);
        persistRecentBatches(next);
      }
      const errCount = data.errors?.length || 0;
      const successCount = (data.processed || []).length;
      if (errCount > 0) {
        toast({ title: `${successCount} photos processed`, description: `${errCount} photo(s) had errors and were skipped.`, variant: "destructive" });
      } else {
        toast({ title: "Photos processed!", description: "Scroll down to download your optimized photos." });
      }
      setTimeout(() => {
        processedRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 200);
    },
    onError: (err: any) => {
      const msg = err?.name === "AbortError" ? "Processing timed out. Try fewer photos or disable watermarks." : (err?.message || "Processing failed");
      toast({ title: "Processing failed", description: msg, variant: "destructive" });
    },
  });

  const [processingStep, setProcessingStep] = useState("");

  const handleProcess = async () => {
    if (uploadedFiles.length === 0) {
      toast({ title: "No photos to process", variant: "destructive" });
      return;
    }

    let fileIds = uploadedFileIds;
    if (fileIds.length === 0) {
      fileIds = [];
      try {
        for (let i = 0; i < uploadedFiles.length; i++) {
          setProcessingStep(`Uploading photo ${i + 1} of ${uploadedFiles.length}...`);
          const localFile = uploadedFiles[i];
          const serverId = await uploadSingleFile(localFile.id);
          fileIds.push(serverId);
        }
        setUploadedFileIds(fileIds);
      } catch (err: any) {
        setProcessingStep("");
        const msg = err?.name === "AbortError"
          ? "Upload timed out. Try with smaller photos."
          : err?.message?.includes("413") || err?.message?.includes("too large")
            ? "One of your photos is too large. Try photos under 20MB each."
            : "Failed to upload photos. Please try again.";
        toast({ title: "Upload failed", description: msg, variant: "destructive" });
        return;
      }
    }

    setProcessingStep("Generating AI descriptions...");
    const descMap: Record<string, string> = {};
    for (let i = 0; i < uploadedFiles.length; i++) {
      const localFile = uploadedFiles[i];
      const fid = fileIds[i];
      if (!localFile || !fid) continue;

      if (descriptions[localFile.id]) {
        descMap[fid] = descriptions[localFile.id];
        continue;
      }

      try {
        setProcessingStep(`Generating description ${i + 1} of ${uploadedFiles.length}...`);
        const data = await descriptionMutation.mutateAsync({
          fileId: localFile.id,
          fileName: localFile.name,
        });
        descMap[fid] = data.description;
        setDescriptions(prev => ({ ...prev, [localFile.id]: data.description }));
      } catch {}
    }

    setProcessingStep("Geotagging address...");
    let lat = businessInfo.lat ?? null;
    let lon = businessInfo.lon ?? null;
    if (!lat && !lon && businessInfo.address) {
      try {
        const geoAddress = [businessInfo.address, businessInfo.city, businessInfo.countyState].filter(Boolean).join(", ");
        const geoRes = await apiRequest("POST", "/api/media/geocode", { address: geoAddress });
        const geoData = await geoRes.json();
        if (geoData.lat && geoData.lon) {
          lat = geoData.lat;
          lon = geoData.lon;
          setBusinessInfo(prev => ({ ...prev, lat, lon }));
        }
      } catch {}
    }

    setProcessingStep("Processing photos...");
    processMutation.mutate({
      fileIds,
      businessInfo: {
        name: businessInfo.companyName,
        phone: businessInfo.phone,
        address: businessInfo.address,
        website: businessInfo.website,
        services: businessInfo.services,
        copyright: businessInfo.copyright || `${businessInfo.companyName}`,
      },
      location: {
        city: businessInfo.city,
        county: businessInfo.countyState,
        lat,
        lon,
      },
      category: categories.join(", "),
      selectedKeywords: Array.from(selectedKeywords),
      serviceAreas: Array.from(selectedServiceAreas),
      watermarkText: watermarkEnabled ? (watermarkText || businessInfo.companyName) : "",
      watermarkEnabled,
      watermarkType,
      watermarkImageId: watermarkType === "image" ? watermarkImageId : "",
      watermarkOpacity,
      mirrorPhotos,
      filters: Object.fromEntries(
        fileIds.map((fid: string, i: number) => {
          const localFile = uploadedFiles[i];
          return [fid, localFile ? getPhotoFilter(localFile.id) : defaultFilters];
        })
      ),
      descriptions: descMap,
    });
    setProcessingStep("");
  };

  const downloadAllMutation = useMutation({
    mutationFn: async (processedIds: string[]) => {
      const res = await fetch("/api/photos/download-all/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ processedIds }),
        credentials: "include",
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({ message: "Download failed" }));
        throw new Error(errData.message || "Download failed");
      }
      const { token } = await res.json();
      if (!token) throw new Error("No download token received");
      return token as string;
    },
    onSuccess: (token) => {
      window.location.href = `/api/photos/download-all/${token}`;
    },
    onError: (err: Error) => {
      toast({ title: "Download failed", description: err.message, variant: "destructive" });
    },
  });

  const downloadSingle = (processedId: string, fileName: string) => {
    const a = document.createElement("a");
    a.href = `/api/photos/download/${processedId}`;
    a.download = fileName;
    a.click();
  };

  const isProcessing = uploadMutation.isPending || processMutation.isPending || !!processingStep;

  return (
    <div className="h-full overflow-y-auto" data-testid="page-photos">
      <div className="max-w-3xl mx-auto px-6 py-12 space-y-8">
        <div className="space-y-2 animate-in">
          <h1 className="text-3xl font-bold tracking-tight" data-testid="text-photos-title">
            SEO Photo Optimizer
          </h1>
          <div className="h-1 w-16 rounded-full bg-gradient-to-r from-[#4A6CF7] to-[#F97316]" />
          <p className="text-sm text-muted-foreground max-w-lg">
            Most contractors upload phone photos with zero optimization. Add watermarks, inject EXIF geotag data, generate AI descriptions, and create SEO-friendly filenames that actually boost your local rankings.
          </p>
        </div>

        <Card className="p-5 space-y-4 animate-in-delay-1" style={{ boxShadow: "var(--shadow-sm)" }}>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <FolderOpen className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold">Templates</span>
              {templates.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {templates.length} saved
                </span>
              )}
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setEditingTemplateId(null);
                setTemplateName(categories.join(", ") || "");
                setShowSaveTemplate(true);
              }}
              data-testid="button-save-template"
            >
              <Save className="h-3.5 w-3.5 mr-1.5" />
              Save Current
            </Button>
          </div>

          {showSaveTemplate && (
            <div className="flex items-end gap-2" data-testid="template-save-form">
              <div className="flex-1 space-y-1.5">
                <Label className="text-xs">Template name</Label>
                <Input
                  value={templateName}
                  onChange={e => setTemplateName(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleSaveTemplate()}
                  placeholder="e.g. Roofing, Siding, Windows..."
                  autoFocus
                  data-testid="input-template-name"
                />
              </div>
              <Button size="sm" onClick={handleSaveTemplate} data-testid="button-confirm-save-template">
                {editingTemplateId ? "Update" : "Save"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { setShowSaveTemplate(false); setEditingTemplateId(null); setTemplateName(""); }}
                data-testid="button-cancel-save-template"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}

          {templates.length === 0 && !showSaveTemplate ? (
            <p className="text-xs text-muted-foreground">
              No templates yet. Set up your business info, category, and keywords, then save as a template for quick reuse.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {templates.map(tpl => (
                <div key={tpl.id} className="flex items-center gap-0.5" data-testid={`template-${tpl.id}`}>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => loadTemplate(tpl)}
                    className="text-xs h-8 pr-1.5"
                    data-testid={`button-load-template-${tpl.id}`}
                  >
                    {tpl.name}
                    {tpl.category && (
                      <span className="text-[10px] text-muted-foreground ml-1.5 opacity-70">
                        {tpl.category}
                      </span>
                    )}
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-8 w-6 px-0" data-testid={`button-template-menu-${tpl.id}`}>
                        <MoreVertical className="h-3.5 w-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => loadTemplate(tpl)} data-testid={`menu-load-template-${tpl.id}`}>
                        <FolderOpen className="h-3.5 w-3.5 mr-2" /> Load
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => startEditTemplate(tpl)} data-testid={`menu-rename-template-${tpl.id}`}>
                        <Pencil className="h-3.5 w-3.5 mr-2" /> Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          loadTemplate(tpl);
                          setEditingTemplateId(tpl.id);
                          setTemplateName(tpl.name);
                          setShowSaveTemplate(true);
                        }}
                        data-testid={`menu-overwrite-template-${tpl.id}`}
                      >
                        <Save className="h-3.5 w-3.5 mr-2" /> Overwrite with current
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => deleteTemplate(tpl.id)}
                        data-testid={`menu-delete-template-${tpl.id}`}
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-5 animate-in-delay-1" style={{ boxShadow: "var(--shadow-sm)" }}>
          <button
            type="button"
            onClick={() => setBusinessCollapsed(!businessCollapsed)}
            className="flex items-center justify-between gap-2 w-full text-left"
            data-testid="button-toggle-business"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Settings className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-sm font-semibold">Business Info</span>
              {businessInfo.companyName && (
                <span className="text-xs text-muted-foreground truncate">
                  {businessInfo.companyName}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {businessInfo.companyName && (
                <span
                  role="button"
                  tabIndex={0}
                  className="inline-flex items-center h-7 px-2 text-xs text-muted-foreground hover:text-destructive cursor-pointer rounded-md hover:bg-accent"
                  onClick={(e) => {
                    e.stopPropagation();
                    setBusinessInfo({
                      companyName: "", phone: "", address: "", city: "",
                      countyState: "", website: "", services: "", copyright: "",
                      lat: null, lon: null,
                    });
                    setWatermarkText("");
                    localStorage.removeItem("gmb-business-info");
                    toast({ title: "Business info cleared" });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.stopPropagation();
                      e.preventDefault();
                      setBusinessInfo({
                        companyName: "", phone: "", address: "", city: "",
                        countyState: "", website: "", services: "", copyright: "",
                        lat: null, lon: null,
                      });
                      setWatermarkText("");
                      localStorage.removeItem("gmb-business-info");
                      toast({ title: "Business info cleared" });
                    }
                  }}
                  data-testid="button-clear-business"
                >
                  Clear
                </span>
              )}
              {businessCollapsed ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
          </button>

          {!businessCollapsed && (
            <div className="mt-4 space-y-4">
              {savedLocations && savedLocations.length > 0 && (
                <div className="space-y-2 pb-3 border-b border-border/50">
                  <Label className="text-xs font-medium flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5" />
                    Load from Saved Location
                  </Label>
                  <Select
                    onValueChange={(val) => {
                      const loc = savedLocations.find((l: any) => String(l.id) === val);
                      if (loc) {
                        setBusinessInfo({
                          companyName: loc.businessName || "",
                          phone: loc.phone || "",
                          address: loc.address || "",
                          city: loc.city || "",
                          countyState: [loc.state].filter(Boolean).join(", "),
                          website: loc.website || "",
                          services: (loc.categories || []).join(", "),
                          copyright: `\u00A9 ${new Date().getFullYear()} ${loc.businessName || ""}`,
                          lat: loc.lat ?? null,
                          lon: loc.lon ?? null,
                        });
                        if (loc.businessName) setWatermarkText(loc.businessName);
                        setBusinessCollapsed(true);
                        toast({ title: "Location loaded", description: `${loc.businessName} info applied.` });
                      }
                    }}
                    data-testid="select-saved-location"
                  >
                    <SelectTrigger className="h-9" data-testid="select-saved-location-trigger">
                      <SelectValue placeholder="Select a saved location..." />
                    </SelectTrigger>
                    <SelectContent>
                      {savedLocations.map((loc: any) => {
                        const detail = loc.address || loc.city || loc.serviceArea || "";
                        return (
                          <SelectItem key={loc.id} value={String(loc.id)} data-testid={`select-location-${loc.id}`}>
                            <div className="flex flex-col">
                              <span>{loc.businessName}</span>
                              {detail && <span className="text-[10px] text-muted-foreground leading-tight">{detail}</span>}
                            </div>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {(!savedLocations || savedLocations.length === 0) && (
                <div className="text-xs text-muted-foreground pb-3 border-b border-border/50 flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5" />
                  <span>No saved locations.</span>
                  <Link href="/locations" className="text-primary hover:underline" data-testid="link-add-locations">
                    Add locations
                  </Link>
                </div>
              )}
              <div className="space-y-3">
                <Label className="text-xs font-medium">Search Business (Google)</Label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      value={businessQuery}
                      onChange={e => setBusinessQuery(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && searchBusiness()}
                      placeholder="Business name + city, or Google Maps URL..."
                      className="pl-9"
                      data-testid="input-business-search"
                    />
                  </div>
                  <Button
                    onClick={searchBusiness}
                    disabled={businessSearching || !businessQuery.trim()}
                    size="sm"
                    data-testid="button-business-search"
                  >
                    {businessSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}
                  </Button>
                </div>
                {businessResults.length > 0 && (
                  <div className="space-y-2" data-testid="business-results">
                    {businessResults.map((r: any, i: number) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => selectBusinessResult(r)}
                        className="w-full text-left p-3 rounded-lg border border-border bg-muted/30 hover:bg-muted/60 transition-colors"
                        data-testid={`button-business-result-${i}`}
                      >
                        <div className="flex items-start gap-3">
                          <Building2 className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-sm truncate">{r.companyName}</p>
                            <div className="flex items-center gap-1 mt-0.5">
                              <MapPin className="h-3 w-3 text-muted-foreground shrink-0" />
                              <p className="text-xs text-muted-foreground truncate">
                                {r.address
                                  ? r.address
                                  : r.serviceAreaBusiness
                                    ? "Service-area business — no public address"
                                    : r.needsManualAddress
                                      ? "Add address manually below"
                                      : "Location unknown"}
                              </p>
                            </div>
                            {(r.phone || r.website) && (
                              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                                {[r.phone, r.website?.replace(/^https?:\/\//, "").replace(/\/$/, "")].filter(Boolean).join(" · ")}
                              </p>
                            )}
                            {r.category && (
                              <p className="text-xs text-muted-foreground mt-0.5 truncate">{r.category}</p>
                            )}
                          </div>
                        </div>
                      </button>
                    ))}
                    {businessNextPageToken && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-full mt-1"
                        onClick={loadMoreBusinessResults}
                        disabled={businessLoadingMore}
                        data-testid="button-load-more-results"
                      >
                        {businessLoadingMore ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : null}
                        {businessLoadingMore ? "Loading..." : "Show More Results"}
                      </Button>
                    )}
                  </div>
                )}
                <div className="relative">
                  <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-border" /></div>
                  <div className="relative flex justify-center text-xs"><span className="bg-card px-2 text-muted-foreground">or enter manually</span></div>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs" htmlFor="companyName">Company Name</Label>
                  <Input
                    id="companyName"
                    value={businessInfo.companyName}
                    onChange={e => updateBusiness("companyName", e.target.value)}
                    placeholder="Acme Roofing"
                    data-testid="input-company-name"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs" htmlFor="phone">Phone</Label>
                  <Input
                    id="phone"
                    value={businessInfo.phone}
                    onChange={e => updateBusiness("phone", e.target.value)}
                    placeholder="(555) 123-4567"
                    data-testid="input-phone"
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label className="text-xs" htmlFor="address">Address</Label>
                  <Input
                    id="address"
                    value={businessInfo.address}
                    onChange={e => updateBusiness("address", e.target.value)}
                    placeholder="123 Main St"
                    data-testid="input-address"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs" htmlFor="city">City</Label>
                  <Input
                    id="city"
                    value={businessInfo.city}
                    onChange={e => updateBusiness("city", e.target.value)}
                    placeholder="Seattle"
                    data-testid="input-city"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs" htmlFor="countyState">County / State</Label>
                  <Input
                    id="countyState"
                    value={businessInfo.countyState}
                    onChange={e => updateBusiness("countyState", e.target.value)}
                    placeholder="King County, WA"
                    data-testid="input-county-state"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs" htmlFor="website">Website</Label>
                  <Input
                    id="website"
                    value={businessInfo.website}
                    onChange={e => updateBusiness("website", e.target.value)}
                    placeholder="https://acmeroofing.com"
                    data-testid="input-website"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs" htmlFor="services">Services</Label>
                  <Input
                    id="services"
                    value={businessInfo.services}
                    onChange={e => updateBusiness("services", e.target.value)}
                    placeholder="Roofing, Siding"
                    data-testid="input-services"
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label className="text-xs" htmlFor="copyright">Copyright Text</Label>
                  <Input
                    id="copyright"
                    value={businessInfo.copyright}
                    onChange={e => updateBusiness("copyright", e.target.value)}
                    placeholder="© 2026 Acme Roofing"
                    data-testid="input-copyright"
                  />
                </div>
              </div>
            </div>
          )}
        </Card>

        <Card className="p-5 space-y-4 animate-in-delay-1 overflow-visible" style={{ boxShadow: "var(--shadow-sm)" }} data-testid="card-service-areas">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold">Service Area Cities</span>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground bg-muted px-1.5 py-0.5 rounded">Optional</span>
            </div>
            <Switch
              checked={serviceAreaEnabled}
              onCheckedChange={setServiceAreaEnabled}
              data-testid="switch-service-area-enabled"
            />
          </div>

          {!serviceAreaEnabled && (
            <p className="text-xs text-muted-foreground">
              Turn on to auto-discover surrounding cities, towns, neighborhoods, or counties around your business address and embed them into photo SEO data.
            </p>
          )}

          {serviceAreaEnabled && (
            <>
              <div className="space-y-2">
                <Label className="text-xs">Area Types</Label>
                <div className="flex flex-wrap gap-2">
                  {[
                    { id: "locality", label: "Cities & Towns" },
                    { id: "neighborhood", label: "Neighborhoods" },
                    { id: "administrative_area_level_3", label: "Townships" },
                    { id: "administrative_area_level_2", label: "Counties" },
                  ].map(t => {
                    const active = serviceAreaTypes.has(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => {
                          setServiceAreaTypes(prev => {
                            const next = new Set(prev);
                            if (next.has(t.id)) {
                              if (next.size > 1) next.delete(t.id);
                            } else {
                              next.add(t.id);
                            }
                            return next;
                          });
                          setServiceAreaResults([]);
                        }}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                          active
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background text-muted-foreground border-border hover-elevate"
                        }`}
                        data-testid={`chip-area-type-${t.id}`}
                      >
                        {t.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                Auto-discover the area types you've selected around your business address. Each photo's filename, description, EXIF tags, and SEO keywords rotate through your chosen areas.
              </p>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Radius: <span className="font-semibold text-foreground">{serviceAreaRadius} miles</span></Label>
              <span className="text-[11px] text-muted-foreground">5–50 mi</span>
            </div>
            <Slider
              value={[serviceAreaRadius]}
              onValueChange={(v) => setServiceAreaRadius(v[0])}
              min={5}
              max={50}
              step={5}
              data-testid="slider-service-radius"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Search Density</Label>
            <div className="flex flex-wrap gap-2">
              {[
                { id: "low", label: "Low", desc: "Big cities only, fast" },
                { id: "medium", label: "Medium", desc: "Most cities & towns" },
                { id: "high", label: "High", desc: "Small enclaves" },
                { id: "max", label: "Max", desc: "Tiny neighborhoods" },
              ].map(d => {
                const active = serviceAreaDensity === d.id;
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setServiceAreaDensity(d.id as any)}
                    title={d.desc}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                      active
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-muted-foreground border-border hover-elevate"
                    }`}
                    data-testid={`chip-density-${d.id}`}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Higher density catches small embedded cities (Highland Park, University Park) but uses more API calls.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="default"
              size="sm"
              onClick={async () => {
                let lat = businessInfo.lat ?? null;
                let lon = businessInfo.lon ?? null;
                if ((!lat || !lon) && businessInfo.address) {
                  try {
                    const geoAddress = [businessInfo.address, businessInfo.city, businessInfo.countyState].filter(Boolean).join(", ");
                    const geoRes = await apiRequest("POST", "/api/media/geocode", { address: geoAddress });
                    const geoData = await geoRes.json();
                    if (geoData.lat && geoData.lon) {
                      lat = geoData.lat; lon = geoData.lon;
                      setBusinessInfo(prev => ({ ...prev, lat, lon }));
                    }
                  } catch {}
                }
                if (!lat || !lon) {
                  toast({ title: "Address required", description: "Enter a business address first.", variant: "destructive" });
                  return;
                }
                setServiceAreaLoading(true);
                try {
                  const res = await apiRequest("POST", "/api/photos/nearby-cities", { lat, lon, radiusMiles: serviceAreaRadius, types: Array.from(serviceAreaTypes), density: serviceAreaDensity });
                  const data = await res.json();
                  const results = (data.results || []) as { name: string; state: string; distance: number }[];
                  setServiceAreaResults(results);
                  setSelectedServiceAreas(new Set(results.map(r => `${r.name}, ${r.state}`)));
                  toast({ title: `Found ${results.length} areas`, description: `Within ${serviceAreaRadius} miles of your address.` });
                } catch (err: any) {
                  toast({ title: "Lookup failed", description: err?.message || "Could not fetch nearby areas", variant: "destructive" });
                } finally {
                  setServiceAreaLoading(false);
                }
              }}
              disabled={serviceAreaLoading}
              data-testid="button-find-service-areas"
            >
              {serviceAreaLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Search className="h-4 w-4 mr-2" />}
              {serviceAreaResults.length > 0 ? "Refresh Areas" : "Find Nearby Areas"}
            </Button>
            {serviceAreaResults.length > 0 && (
              <>
                <Button variant="outline" size="sm" onClick={() => setSelectedServiceAreas(new Set(serviceAreaResults.map(r => `${r.name}, ${r.state}`)))} data-testid="button-select-all-areas">
                  Select All
                </Button>
                <Button variant="outline" size="sm" onClick={() => setSelectedServiceAreas(new Set())} data-testid="button-clear-areas">
                  Clear
                </Button>
              </>
            )}
          </div>

          <div className="space-y-2 pt-2 border-t border-border">
            <Label className="text-xs">Or add specific cities manually</Label>
            <div className="flex gap-2">
              <Input
                value={manualCityInput}
                onChange={(e) => setManualCityInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); addManualCities(); }
                }}
                placeholder="e.g. Plano, TX, Frisco, TX, McKinney, TX"
                className="h-8 text-xs"
                data-testid="input-manual-cities"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={addManualCities}
                disabled={!manualCityInput.trim()}
                data-testid="button-add-manual-cities"
                className="h-8"
              >
                <Plus className="h-3.5 w-3.5 mr-1" /> Add
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Comma-separated. Pairs like "City, ST" are detected automatically. State-less entries (just "Plano") use your business state.
            </p>
          </div>

          {serviceAreaResults.length > 0 && (() => {
            const filterText = serviceAreaNameFilter.trim().toLowerCase();
            const filtered = filterText
              ? serviceAreaResults.filter(r => r.name.toLowerCase().includes(filterText) || r.state.toLowerCase().includes(filterText))
              : serviceAreaResults;
            return (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Input
                    value={serviceAreaNameFilter}
                    onChange={(e) => setServiceAreaNameFilter(e.target.value)}
                    placeholder="Filter areas by name…"
                    className="h-8 text-xs"
                    data-testid="input-area-filter"
                  />
                  {serviceAreaNameFilter && (
                    <Button variant="ghost" size="sm" onClick={() => setServiceAreaNameFilter("")} data-testid="button-clear-area-filter" className="h-8">
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {selectedServiceAreas.size} of {serviceAreaResults.length} selected
                  {filterText && ` · showing ${filtered.length}`}
                </div>
                <div className="max-h-64 overflow-y-auto rounded-md border border-border p-2 grid grid-cols-1 sm:grid-cols-2 gap-1">
                  {filtered.map((r, i) => {
                    const key = `${r.name}, ${r.state}`;
                    const checked = selectedServiceAreas.has(key);
                    return (
                      <label key={`${key}-${i}`} className="flex items-center gap-2 px-2 py-1.5 text-sm rounded-sm hover:bg-accent cursor-pointer" data-testid={`label-area-${i}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            setSelectedServiceAreas(prev => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(key); else next.delete(key);
                              return next;
                            });
                          }}
                          data-testid={`checkbox-area-${i}`}
                        />
                        <span className="flex-1 truncate">{r.name}{r.state ? `, ${r.state}` : ""}</span>
                        <span className="text-[11px] text-muted-foreground shrink-0">{r.distance} mi</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })()}
            </>
          )}
        </Card>

        <Card className="p-5 space-y-4 animate-in-delay-1 overflow-visible" style={{ boxShadow: "var(--shadow-sm)" }}>
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold">Category & Keywords</span>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Category</Label>
            <div className="relative" data-testid="select-category">
              <button
                ref={categoryBtnRef}
                type="button"
                onClick={() => setCategoryDropdownOpen(!categoryDropdownOpen)}
                className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <span className={categories.length === 0 ? "text-muted-foreground" : "truncate"}>
                  {categories.length === 0 ? "Select categories" : categories.join(", ")}
                </span>
                <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
              </button>
              {categoryDropdownOpen && createPortal(
                <>
                  <div className="fixed inset-0" style={{ zIndex: 99998 }} onClick={() => { setCategoryDropdownOpen(false); setCategorySearch(""); }} />
                  <div className="fixed rounded-md border bg-popover shadow-lg flex flex-col" style={{ zIndex: 99999, width: categoryBtnRef.current?.offsetWidth, top: (categoryBtnRef.current?.getBoundingClientRect().bottom ?? 0) + 4, left: categoryBtnRef.current?.getBoundingClientRect().left, maxHeight: 360 }}>
                    <div className="p-2 border-b">
                      <Input
                        autoFocus
                        value={categorySearch}
                        onChange={(e) => setCategorySearch(e.target.value)}
                        placeholder="Search Google categories..."
                        className="h-8 text-xs"
                        data-testid="input-category-search"
                      />
                    </div>
                    <div className="overflow-y-auto p-1 flex-1">
                      {(() => {
                        const q = categorySearch.trim().toLowerCase();
                        const allConstruction = Object.keys(categoryKeywords);
                        const modifierSet = new Set<string>(MODIFIER_CATEGORIES as readonly string[]);
                        const buildingTypes = allConstruction.filter(c => modifierSet.has(c));
                        const trades = allConstruction.filter(c => !modifierSet.has(c));
                        const constructionSet = new Set(allConstruction);
                        const otherAll = GBP_CATEGORIES.filter(c => !constructionSet.has(c));
                        const filterFn = (c: string) => !q || c.toLowerCase().includes(q);
                        const filteredBuildingTypes = buildingTypes.filter(filterFn);
                        const filteredTrades = trades.filter(filterFn);
                        const filteredOther = otherAll.filter(filterFn).slice(0, q ? 200 : 100);
                        const renderRow = (cat: string, hasKw: boolean) => (
                          <label
                            key={cat}
                            className="flex items-center gap-2 px-2 py-1.5 text-sm rounded-sm hover:bg-accent cursor-pointer"
                            data-testid={`category-option-${cat.toLowerCase().replace(/\s+/g, "-")}`}
                          >
                            <input
                              type="checkbox"
                              checked={categories.includes(cat)}
                              onChange={() => {
                                setCategories(prev => {
                                  const next = prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat];
                                  const allKws = [...new Set(next.flatMap(c => categoryKeywords[c] ?? []))];
                                  setSelectedKeywords(prevSel => {
                                    const merged = new Set(prevSel);
                                    allKws.forEach(k => merged.add(k));
                                    return merged;
                                  });
                                  setRemovedKeywords(new Set());
                                  return next;
                                });
                              }}
                              className="accent-primary"
                            />
                            <span className="flex-1 truncate">{cat}</span>
                            {hasKw && <span className="text-[10px] uppercase tracking-wide text-muted-foreground">auto kw</span>}
                          </label>
                        );
                        return (
                          <>
                            {filteredBuildingTypes.length > 0 && (
                              <>
                                <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">Building Type (combine with a trade)</div>
                                {filteredBuildingTypes.map(c => renderRow(c, true))}
                                <div className="my-1 border-t border-border" />
                              </>
                            )}
                            {filteredTrades.length > 0 && (
                              <>
                                <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">Trade / Service (auto keywords)</div>
                                {filteredTrades.map(c => renderRow(c, true))}
                              </>
                            )}
                            {filteredOther.length > 0 && (
                              <>
                                <div className="my-1 border-t border-border" />
                                <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">All Google categories</div>
                                {filteredOther.map(c => renderRow(c, false))}
                                {!q && otherAll.length > filteredOther.length && (
                                  <div className="px-2 py-1.5 text-[11px] text-muted-foreground italic">
                                    Showing first {filteredOther.length} of {otherAll.length}. Type to search…
                                  </div>
                                )}
                              </>
                            )}
                            {filteredBuildingTypes.length === 0 && filteredTrades.length === 0 && filteredOther.length === 0 && (
                              <div className="px-2 py-3 text-xs text-muted-foreground text-center">No categories match "{q}"</div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </div>
                </>,
                document.body
              )}
            </div>
          </div>

          {(keywords.length > 0 || customKeywords.length > 0) && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs">Keywords</Label>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={selectAllKeywords}
                    className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                    data-testid="button-select-all-keywords"
                  >
                    Select all
                  </button>
                  <span className="text-muted-foreground/40">|</span>
                  <button
                    type="button"
                    onClick={clearKeywords}
                    className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                    data-testid="button-clear-keywords"
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-1 max-h-52 overflow-y-auto">
                {allKeywords.map(kw => {
                  const isCustom = customKeywords.includes(kw);
                  return (
                    <label
                      key={kw}
                      className="flex items-center gap-2.5 py-1.5 px-2 rounded-md hover:bg-muted/50 cursor-pointer group transition-colors"
                      data-testid={`keyword-row-${kw.toLowerCase().replace(/\s+/g, "-")}`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedKeywords.has(kw)}
                        onChange={() => toggleKeyword(kw)}
                        className="accent-primary h-3.5 w-3.5 shrink-0"
                        data-testid={`checkbox-keyword-${kw.toLowerCase().replace(/\s+/g, "-")}`}
                      />
                      <span className="text-xs flex-1">{kw}</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (isCustom) {
                            setCustomKeywords(prev => prev.filter(k => k !== kw));
                          } else {
                            setRemovedKeywords(prev => new Set([...prev, kw]));
                          }
                          setSelectedKeywords(prev => { const next = new Set(prev); next.delete(kw); return next; });
                        }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                        data-testid={`button-remove-keyword-${kw.toLowerCase().replace(/\s+/g, "-")}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </label>
                  );
                })}
              </div>
              <div className="flex gap-2">
                <Input
                  value={newCustomKeyword}
                  onChange={(e) => {
                    const val = e.target.value;
                    setNewCustomKeyword(val);
                    if (val.includes(",")) {
                      const trailing = val.endsWith(",");
                      addKeywordsFromInput(val);
                      if (!trailing) {
                        const last = val.split(",").pop()?.trim() ?? "";
                        if (last) setNewCustomKeyword(last);
                      }
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newCustomKeyword.trim()) {
                      e.preventDefault();
                      addKeywordsFromInput(newCustomKeyword);
                    }
                  }}
                  onPaste={(e) => {
                    const text = e.clipboardData.getData("text");
                    if (text.includes(",") || text.includes("\n")) {
                      e.preventDefault();
                      addKeywordsFromInput((newCustomKeyword + " " + text).trim());
                    }
                  }}
                  placeholder="Add keywords (paste comma-separated, e.g. Floor Installation, Tile Repair)"
                  className="text-xs h-8"
                  data-testid="input-custom-keyword"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 px-3 shrink-0"
                  disabled={!newCustomKeyword.trim()}
                  onClick={() => addKeywordsFromInput(newCustomKeyword)}
                  data-testid="button-add-custom-keyword"
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add
                </Button>
              </div>
            </div>
          )}

          {keywords.length === 0 && customKeywords.length === 0 && categories.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs">Keywords</Label>
              <div className="flex gap-2">
                <Input
                  value={newCustomKeyword}
                  onChange={(e) => {
                    const val = e.target.value;
                    setNewCustomKeyword(val);
                    if (val.includes(",")) {
                      const trailing = val.endsWith(",");
                      addKeywordsFromInput(val);
                      if (!trailing) {
                        const last = val.split(",").pop()?.trim() ?? "";
                        if (last) setNewCustomKeyword(last);
                      }
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newCustomKeyword.trim()) {
                      e.preventDefault();
                      addKeywordsFromInput(newCustomKeyword);
                    }
                  }}
                  onPaste={(e) => {
                    const text = e.clipboardData.getData("text");
                    if (text.includes(",") || text.includes("\n")) {
                      e.preventDefault();
                      addKeywordsFromInput((newCustomKeyword + " " + text).trim());
                    }
                  }}
                  placeholder="Add keywords (paste comma-separated, e.g. Floor Installation, Tile Repair)"
                  className="text-xs h-8"
                  data-testid="input-custom-keyword-empty"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 px-3 shrink-0"
                  disabled={!newCustomKeyword.trim()}
                  onClick={() => addKeywordsFromInput(newCustomKeyword)}
                  data-testid="button-add-custom-keyword-empty"
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add
                </Button>
              </div>
            </div>
          )}
        </Card>

        <Card className="p-5 space-y-4 animate-in-delay-2" style={{ boxShadow: "var(--shadow-sm)" }}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Camera className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold">Photos</span>
              {uploadedFiles.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {uploadedFiles.length} file{uploadedFiles.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>
            {uploadedFiles.length > 0 && (
              <button
                type="button"
                onClick={clearAllFiles}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                data-testid="button-clear-photos"
              >
                <Trash2 className="h-3 w-3" />
                Clear all
              </button>
            )}
          </div>

          <div
            onDragOver={e => e.preventDefault()}
            onDrop={handleFileDrop}
            className="border-2 border-dashed border-border rounded-md p-8 text-center space-y-3 transition-colors hover:border-muted-foreground/40"
            data-testid="dropzone-photos"
          >
            <Upload className="h-8 w-8 mx-auto text-muted-foreground/40" />
            <div>
              <p className="text-sm text-muted-foreground">
                Drag and drop photos here, or
              </p>
              <div className="flex items-center justify-center gap-2 mt-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  data-testid="button-browse-files"
                >
                  <FileImage className="h-3.5 w-3.5 mr-1.5" />
                  Browse Files
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const input = document.createElement("input");
                    input.type = "file";
                    input.accept = "image/jpeg,image/png";
                    input.capture = "environment";
                    input.multiple = true;
                    input.onchange = (e: any) => {
                      const files = Array.from(e.target.files || []) as File[];
                      addFiles(files.filter(f => /\.(jpe?g|png)$/i.test(f.name)));
                    };
                    input.click();
                  }}
                  data-testid="button-camera-capture"
                >
                  <Camera className="h-3.5 w-3.5 mr-1.5" />
                  Camera
                </Button>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground/60">JPG, JPEG, PNG accepted</p>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".jpg,.jpeg,.png,image/jpeg,image/png"
            multiple
            onChange={handleFileSelect}
            className="hidden"
            data-testid="input-file-upload"
          />

          {uploadedFiles.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  {uploadedFiles.length} photo{uploadedFiles.length !== 1 ? "s" : ""} — click a photo to preview &amp; edit
                </p>
                {uploadedFiles.length > 1 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={autoEnhanceAll}
                    disabled={enhancingPhotos.size > 0}
                    className="text-xs h-7"
                    data-testid="button-auto-enhance-all"
                  >
                    {enhancingPhotos.size > 0 ? (
                      <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Enhancing...</>
                    ) : (
                      <><Wand2 className="h-3 w-3 mr-1" /> Auto Enhance All</>
                    )}
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                {uploadedFiles.map(file => {
                  const isSelected = selectedPhotoId === file.id;
                  const f = getPhotoFilter(file.id);
                  const hasCustomFilter = f.brightness !== 1.0 || f.contrast !== 1.0 || f.saturation !== 1.0;
                  return (
                    <div
                      key={file.id}
                      className={`relative group rounded-md overflow-visible aspect-square cursor-pointer ring-2 transition-all ${isSelected ? "ring-primary" : "ring-transparent hover:ring-primary/40"}`}
                      onClick={() => setSelectedPhotoId(isSelected ? null : file.id)}
                      data-testid={`photo-thumbnail-${file.id}`}
                    >
                      <img
                        src={file.preview}
                        alt={file.name}
                        className="w-full h-full object-cover rounded-md"
                        style={getFilterStyle(file.id)}
                      />
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); removeFile(file.id); if (isSelected) setSelectedPhotoId(null); }}
                        className="absolute top-1 right-1 p-0.5 rounded-full bg-background/80 text-foreground invisible group-hover:visible transition-opacity"
                        data-testid={`button-remove-photo-${file.id}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                      <div className="absolute top-1 left-1 flex items-center gap-1">
                        {hasCustomFilter && (
                          <div className="w-2 h-2 rounded-full bg-primary" />
                        )}
                        <button
                          type="button"
                          onClick={e => { e.stopPropagation(); setSelectedPhotoId(file.id); }}
                          className="p-0.5 rounded-full bg-black/50 text-white invisible group-hover:visible transition-opacity hover:bg-black/70"
                          data-testid={`button-expand-photo-${file.id}`}
                        >
                          <Maximize2 className="h-2.5 w-2.5" />
                        </button>
                      </div>
                      <div className="absolute bottom-0 left-0 right-0 bg-background/70 px-1 py-0.5 rounded-b-md">
                        <p className="text-[10px] text-foreground truncate">{file.name}</p>
                      </div>
                    </div>
                  );
                })}
              </div>

              {selectedPhotoId && (() => {
                const file = uploadedFiles.find(f => f.id === selectedPhotoId);
                if (!file) return null;
                const f = getPhotoFilter(file.id);
                const currentIdx = uploadedFiles.findIndex(uf => uf.id === selectedPhotoId);
                const prevPhoto = currentIdx > 0 ? uploadedFiles[currentIdx - 1] : null;
                const nextPhoto = currentIdx < uploadedFiles.length - 1 ? uploadedFiles[currentIdx + 1] : null;
                return createPortal(
                  <div className="fixed inset-0 z-[9999] bg-black/90 flex" onClick={() => setSelectedPhotoId(null)} data-testid="modal-photo-editor">
                    <div className="flex flex-col lg:flex-row w-full h-full" onClick={e => e.stopPropagation()}>
                      <div className="flex-1 flex items-center justify-center relative p-4 min-h-0">
                        {prevPhoto && (
                          <button
                            onClick={() => setSelectedPhotoId(prevPhoto.id)}
                            className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-sm flex items-center justify-center text-white transition-colors z-10"
                            data-testid="button-prev-photo"
                          >
                            <ChevronDown className="h-5 w-5 -rotate-90" />
                          </button>
                        )}
                        <img
                          src={file.preview}
                          alt={file.name}
                          className="max-w-full max-h-full object-contain rounded-lg shadow-2xl transition-all duration-200"
                          style={getFilterStyle(file.id)}
                          data-testid="img-photo-preview-large"
                        />
                        {nextPhoto && (
                          <button
                            onClick={() => setSelectedPhotoId(nextPhoto.id)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-sm flex items-center justify-center text-white transition-colors z-10"
                            data-testid="button-next-photo"
                          >
                            <ChevronDown className="h-5 w-5 rotate-90" />
                          </button>
                        )}
                        <button
                          onClick={() => setSelectedPhotoId(null)}
                          className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-sm flex items-center justify-center text-white transition-colors lg:hidden"
                          data-testid="button-close-preview-mobile"
                        >
                          <X className="h-5 w-5" />
                        </button>
                        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/60 backdrop-blur-sm rounded-lg px-3 py-1.5 text-white text-xs">
                          {currentIdx + 1} / {uploadedFiles.length} — {file.name}
                        </div>
                      </div>

                      <div className="w-full lg:w-80 bg-background border-t lg:border-t-0 lg:border-l border-border p-5 space-y-5 overflow-y-auto shrink-0" data-testid="panel-photo-editor">
                        <div className="flex items-center justify-between">
                          <h3 className="font-semibold text-sm flex items-center gap-2">
                            <Settings className="h-4 w-4 text-primary" />
                            Photo Editor
                          </h3>
                          <button
                            onClick={() => setSelectedPhotoId(null)}
                            className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors hidden lg:flex"
                            data-testid="button-close-editor"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>

                        <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border border-border/50">
                          <img
                            src={file.preview}
                            alt={file.name}
                            className="w-12 h-12 object-cover rounded-md shrink-0"
                            style={getFilterStyle(file.id)}
                          />
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{file.name}</p>
                            <p className="text-[11px] text-muted-foreground">Adjust filters below — preview updates live</p>
                          </div>
                        </div>

                        <div className="space-y-4">
                          <div className="space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <Label className="text-xs font-medium">Brightness</Label>
                              <span className="text-xs text-muted-foreground tabular-nums bg-muted px-1.5 py-0.5 rounded">{f.brightness.toFixed(2)}</span>
                            </div>
                            <Slider
                              value={[f.brightness]}
                              onValueChange={([v]) => updatePhotoFilter(file.id, "brightness", v)}
                              min={0.5} max={2.0} step={0.05}
                              data-testid="slider-brightness"
                            />
                          </div>
                          <div className="space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <Label className="text-xs font-medium">Contrast</Label>
                              <span className="text-xs text-muted-foreground tabular-nums bg-muted px-1.5 py-0.5 rounded">{f.contrast.toFixed(2)}</span>
                            </div>
                            <Slider
                              value={[f.contrast]}
                              onValueChange={([v]) => updatePhotoFilter(file.id, "contrast", v)}
                              min={0.5} max={2.0} step={0.05}
                              data-testid="slider-contrast"
                            />
                          </div>
                          <div className="space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <Label className="text-xs font-medium">Saturation</Label>
                              <span className="text-xs text-muted-foreground tabular-nums bg-muted px-1.5 py-0.5 rounded">{f.saturation.toFixed(2)}</span>
                            </div>
                            <Slider
                              value={[f.saturation]}
                              onValueChange={([v]) => updatePhotoFilter(file.id, "saturation", v)}
                              min={0.5} max={2.0} step={0.05}
                              data-testid="slider-saturation"
                            />
                          </div>
                        </div>

                        <div className="space-y-2 pt-1">
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() => autoEnhancePhoto(file.id)}
                            disabled={enhancingPhotos.has(file.id)}
                            className="w-full text-xs h-8"
                            data-testid="button-auto-enhance"
                          >
                            {enhancingPhotos.has(file.id) ? (
                              <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> Analyzing...</>
                            ) : (
                              <><Wand2 className="h-3 w-3 mr-1.5" /> Auto Enhance</>
                            )}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => resetPhotoFilter(file.id)}
                            className="w-full text-xs h-8"
                            data-testid="button-reset-filter"
                          >
                            Reset to Defaults
                          </Button>
                          {uploadedFiles.length > 1 && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => applyFiltersToAll(file.id)}
                              className="w-full text-xs h-8"
                              data-testid="button-apply-filters-all"
                            >
                              Apply to All Photos
                            </Button>
                          )}
                        </div>

                        {uploadedFiles.length > 1 && (
                          <div className="pt-2 border-t border-border/50">
                            <p className="text-[11px] text-muted-foreground mb-2 font-medium">All Photos</p>
                            <div className="grid grid-cols-4 gap-1.5">
                              {uploadedFiles.map(uf => (
                                <button
                                  key={uf.id}
                                  onClick={() => setSelectedPhotoId(uf.id)}
                                  className={`aspect-square rounded-md overflow-hidden ring-2 transition-all ${uf.id === selectedPhotoId ? "ring-primary" : "ring-transparent hover:ring-primary/40"}`}
                                  data-testid={`button-switch-photo-${uf.id}`}
                                >
                                  <img src={uf.preview} alt={uf.name} className="w-full h-full object-cover" style={getFilterStyle(uf.id)} />
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>,
                  document.body
                );
              })()}
            </div>
          )}
        </Card>

        <Card className="p-5 space-y-4 animate-in-delay-2" style={{ boxShadow: "var(--shadow-sm)" }}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Wand2 className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold">Watermark</span>
            </div>
            <Switch
              checked={watermarkEnabled}
              onCheckedChange={setWatermarkEnabled}
              data-testid="switch-watermark"
            />
          </div>

          {watermarkEnabled && (
            <div className="space-y-4">
              <div className="flex gap-2">
                <Button
                  variant={watermarkType === "text" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setWatermarkType("text")}
                  data-testid="button-watermark-text-mode"
                >
                  Text
                </Button>
                <Button
                  variant={watermarkType === "image" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setWatermarkType("image")}
                  data-testid="button-watermark-image-mode"
                >
                  Image / Logo
                </Button>
              </div>

              {watermarkType === "text" ? (
                <div className="space-y-1.5">
                  <Label className="text-xs">Watermark text</Label>
                  <Input
                    value={watermarkText}
                    onChange={e => setWatermarkText(e.target.value)}
                    placeholder={businessInfo.companyName || "Company Name"}
                    data-testid="input-watermark-text"
                  />
                </div>
              ) : (
                <div className="space-y-3">
                  <Label className="text-xs">Watermark image (PNG or JPEG)</Label>
                  <input
                    ref={watermarkInputRef}
                    type="file"
                    accept=".png,.jpg,.jpeg"
                    onChange={handleWatermarkImageSelect}
                    className="hidden"
                  />
                  {watermarkImagePreview ? (
                    <div className="flex items-center gap-3">
                      <div className="relative w-20 h-20 rounded-lg border border-border overflow-hidden bg-muted/30 flex items-center justify-center">
                        <img
                          src={watermarkImagePreview}
                          alt="Watermark preview"
                          className="max-w-full max-h-full object-contain"
                          style={{ opacity: watermarkOpacity }}
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <p className="text-xs text-muted-foreground truncate max-w-[160px]">
                          {watermarkImageFile?.name}
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={removeWatermarkImage}
                          data-testid="button-remove-watermark-image"
                        >
                          <X className="h-3 w-3 mr-1" /> Remove
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => watermarkInputRef.current?.click()}
                      data-testid="button-upload-watermark-image"
                    >
                      <Upload className="h-4 w-4 mr-2" /> Upload Logo
                    </Button>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-xs">Opacity</Label>
                  <span className="text-xs text-muted-foreground tabular-nums">{Math.round(watermarkOpacity * 100)}%</span>
                </div>
                <Slider
                  value={[watermarkOpacity]}
                  onValueChange={([v]) => setWatermarkOpacity(v)}
                  min={0.1}
                  max={1.0}
                  step={0.05}
                  data-testid="slider-watermark-opacity"
                />
              </div>
            </div>
          )}
        </Card>

        <Card className="p-5 space-y-3 animate-in-delay-3" style={{ boxShadow: "var(--shadow-sm)" }}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <FlipHorizontal className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold">Mirror Photos</span>
            </div>
            <Switch
              checked={mirrorPhotos}
              onCheckedChange={setMirrorPhotos}
              data-testid="switch-mirror-photos"
            />
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Horizontally flips every photo so search engines see them as completely new images, not duplicates of what's already on your account or anywhere else online.
          </p>
        </Card>

        <Card className="p-5 space-y-4 animate-in-delay-3" style={{ boxShadow: "var(--shadow-sm)" }}>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Download className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold">Process & Download</span>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground" htmlFor="ai-toggle">AI Descriptions</Label>
              <Switch
                id="ai-toggle"
                checked={useAIDescriptions}
                onCheckedChange={setUseAIDescriptions}
                data-testid="switch-ai-descriptions"
              />
            </div>
          </div>

          {!useAIDescriptions && (
            <p className="text-xs text-muted-foreground">
              Using smart templates for SEO descriptions (free, instant). Toggle on AI for unique OpenAI-generated descriptions.
            </p>
          )}
          {useAIDescriptions && (
            <p className="text-xs text-muted-foreground">
              Using OpenAI to generate unique descriptions per photo. This uses API credits.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={handleProcess}
              disabled={isProcessing || uploadedFiles.length === 0}
              data-testid="button-process-photos"
            >
              {isProcessing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Wand2 className="h-4 w-4 mr-2" />
              )}
              {isProcessing ? (processingStep || "Processing...") : "Process Photos"}
            </Button>

            {processedFiles.length > 0 && (
              <Button
                variant="outline"
                onClick={() =>
                  downloadAllMutation.mutate(processedFiles.map(f => f.processedId))
                }
                disabled={downloadAllMutation.isPending}
                data-testid="button-download-all"
              >
                {downloadAllMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-2" />
                )}
                Download All (ZIP)
              </Button>
            )}

            {processedFiles.length > 0 && (
              <Button
                variant="outline"
                onClick={() => { fetchFolders(); setShowSaveToLibrary(true); }}
                data-testid="button-save-to-library"
              >
                <FolderOpen className="h-4 w-4 mr-2" />
                Save to Media Library
              </Button>
            )}
          </div>

          {showSaveToLibrary && (
            <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50" onClick={() => setShowSaveToLibrary(false)}>
              <div className="bg-background border border-border rounded-xl shadow-2xl w-full max-w-md mx-4 p-5 space-y-4" onClick={e => e.stopPropagation()} data-testid="modal-save-to-library">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-sm flex items-center gap-2">
                    <FolderOpen className="h-4 w-4 text-amber-500" />
                    Save to Media Library
                  </h3>
                  <button onClick={() => setShowSaveToLibrary(false)} className="text-muted-foreground hover:text-foreground">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Save {processedFiles.length} processed photo{processedFiles.length !== 1 ? "s" : ""} to a folder. These photos will be stored permanently and available to attach to review requests.
                </p>
                {mediaFolders.length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-xs">Select Existing Folder</Label>
                    <div className="max-h-32 overflow-y-auto space-y-1 border border-border rounded-lg p-2">
                      {mediaFolders.map(f => (
                        <button
                          key={f.id}
                          onClick={() => { setSelectedFolderId(f.id); setNewFolderName(""); }}
                          className={`w-full text-left text-xs px-2 py-1.5 rounded-md flex items-center gap-2 transition-colors ${selectedFolderId === f.id ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted"}`}
                          data-testid={`folder-option-${f.id}`}
                        >
                          <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                          {f.name}
                          {selectedFolderId === f.id && <Check className="h-3 w-3 ml-auto" />}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  <Label className="text-xs">{mediaFolders.length > 0 ? "Or Create New Folder" : "Create a Folder"}</Label>
                  <Input
                    value={newFolderName}
                    onChange={e => { setNewFolderName(e.target.value); if (e.target.value) setSelectedFolderId(null); }}
                    placeholder="e.g. Roofing Project - 123 Main St"
                    className="text-sm"
                    data-testid="input-new-folder-name"
                  />
                </div>
                <div className="flex gap-2 pt-1">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => setShowSaveToLibrary(false)} data-testid="button-cancel-save">
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1 bg-amber-500 hover:bg-amber-600 text-white"
                    onClick={handleSaveToLibrary}
                    disabled={savingToLibrary || (!selectedFolderId && !newFolderName.trim())}
                    data-testid="button-confirm-save-library"
                  >
                    {savingToLibrary ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                    {savingToLibrary ? "Saving..." : "Save Photos"}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {processedFiles.length > 0 && (
            <div ref={processedRef} className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {processedFiles.length} photo{processedFiles.length !== 1 ? "s" : ""} processed
              </p>
              <div className="space-y-1.5">
                {processedFiles.map(pf => (
                  <div
                    key={pf.processedId}
                    className="flex items-center justify-between gap-2 py-1.5 px-2 rounded-md bg-muted/50"
                    data-testid={`processed-file-${pf.processedId}`}
                  >
                    <span className="text-xs truncate flex-1">{pf.fileName}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => downloadSingle(pf.processedId, pf.fileName)}
                      data-testid={`button-download-${pf.processedId}`}
                    >
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {uploadedFiles.length === 0 && processedFiles.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Upload photos and configure settings above, then click Process to optimize your images.
            </p>
          )}
        </Card>

        {recentBatches.length > 0 && (
          <Card className="p-5 space-y-4" style={{ boxShadow: "var(--shadow-sm)" }} data-testid="card-recent-batches">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Wand2 className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold">Recent Batches</span>
                <Badge variant="outline" className="text-[10px]">Last {recentBatches.length}</Badge>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => persistRecentBatches([])}
                data-testid="button-clear-recent-batches"
              >
                Clear all
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              If processing succeeds but the page is reloaded or the server restarts, your last 3 batches are saved here so you can re-download without starting over.
            </p>
            <div className="space-y-2">
              {recentBatches.map(batch => {
                const date = new Date(batch.savedAt);
                const dateStr = `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
                return (
                  <div
                    key={batch.id}
                    className="flex items-center justify-between gap-3 p-3 rounded-md border border-border bg-muted/30"
                    data-testid={`row-batch-${batch.id}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate" data-testid={`text-batch-name-${batch.id}`}>
                        {batch.companyName}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {batch.files.length} photo{batch.files.length !== 1 ? "s" : ""} · {dateStr}
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setProcessedFiles(batch.files);
                          toast({ title: "Batch restored", description: "Scroll up to the processed photos section to download." });
                          setTimeout(() => processedRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 200);
                        }}
                        data-testid={`button-restore-batch-${batch.id}`}
                      >
                        Restore
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          downloadAllMutation.mutate(batch.files.map(f => f.processedId));
                        }}
                        disabled={downloadAllMutation.isPending}
                        data-testid={`button-download-batch-${batch.id}`}
                      >
                        <Download className="h-3.5 w-3.5 mr-1" />
                        Download ZIP
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => persistRecentBatches(recentBatches.filter(b => b.id !== batch.id))}
                        data-testid={`button-remove-batch-${batch.id}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {processedFiles.length > 0 && (
          <Card className="p-5 space-y-4 animate-in-delay-5" style={{ boxShadow: "var(--shadow-sm)" }}>
            <div className="flex items-center gap-2">
              <ExternalLink className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold">Upload to Platforms</span>
              <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-600 border-amber-500/20">Platinum</Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Download your optimized photos above, then upload them directly to your business profiles.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open("https://business.google.com/locations", "_blank")}
                data-testid="button-upload-google"
              >
                <img src="https://www.gstatic.com/images/branding/product/1x/googleg_16dp.png" alt="" className="h-4 w-4 mr-2" />
                Upload to Google Business Profile
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open("https://biz.yelp.com", "_blank")}
                data-testid="button-upload-yelp"
              >
                <span className="mr-2 text-red-500 font-bold text-sm">Y</span>
                Upload to Yelp Business
              </Button>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
