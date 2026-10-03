import { useState, useCallback, useRef, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  FolderOpen, Plus, Trash2, Upload, Image, X, Loader2, Check,
  MapPin, Pencil, ArrowLeft, Download, Search, MoreVertical, ChevronRight,
  FolderPlus, ImagePlus, Navigation, CheckCircle2, Grid3X3, List,
} from "lucide-react";
import { AppPage, PageHeader, EmptyState } from "@/components/app-ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// Hover-revealed controls must stay visible on touch screens (no hover) and
// when focused from the keyboard, or phone users can't tell they exist.
const REVEAL_ON_HOVER = "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100";

interface Folder {
  id: number;
  name: string;
  clientAddress: string | null;
  lat: number | null;
  lon: number | null;
  createdAt: string;
}

interface Photo {
  id: number;
  name: string;
  url: string;
  size: number | null;
  createdAt: string;
}

function formatFileSize(bytes: number | null) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function MediaLibraryPage() {
  const { toast } = useToast();

  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFolderId, setActiveFolderId] = useState<number | null>(null);
  const [activeFolder, setActiveFolder] = useState<Folder | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderAddress, setNewFolderAddress] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [geocodingAddress, setGeocodingAddress] = useState(false);
  const [geocodedResult, setGeocodedResult] = useState<{ lat: number; lon: number; formattedAddress: string } | null>(null);

  const [editingFolder, setEditingFolder] = useState<Folder | null>(null);
  const [editFolderName, setEditFolderName] = useState("");
  const [editFolderAddress, setEditFolderAddress] = useState("");
  const [editGeoResult, setEditGeoResult] = useState<{ lat: number; lon: number; formattedAddress: string } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editGeocoding, setEditGeocoding] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [selectedPhotos, setSelectedPhotos] = useState<Set<number>>(new Set());
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [renamingPhoto, setRenamingPhoto] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [previewPhoto, setPreviewPhoto] = useState<Photo | null>(null);
  const [deletingFolder, setDeletingFolder] = useState<number | null>(null);
  // Folder awaiting delete confirmation; photoCount is null until it is known.
  const [confirmFolder, setConfirmFolder] = useState<{ folder: Folder; photoCount: number | null } | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchFolders = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/media/folders", { credentials: "include" });
      if (res.ok) setFolders(await res.json());
    } catch {} finally { setLoading(false); }
  }, []);

  const fetchPhotos = useCallback(async (folderId: number) => {
    setPhotosLoading(true);
    try {
      const res = await fetch(`/api/media/folders/${folderId}/photos`, { credentials: "include" });
      if (res.ok) setPhotos(await res.json());
    } catch {} finally { setPhotosLoading(false); }
  }, []);

  useEffect(() => { fetchFolders(); }, [fetchFolders]);

  const openFolder = (folder: Folder) => {
    setActiveFolderId(folder.id);
    setActiveFolder(folder);
    setSelectedPhotos(new Set());
    setSearchQuery("");
    fetchPhotos(folder.id);
  };

  const goBack = () => {
    setActiveFolderId(null);
    setActiveFolder(null);
    setPhotos([]);
    setSelectedPhotos(new Set());
    setSearchQuery("");
  };

  const geocodeAddress = async (address: string, mode: "create" | "edit") => {
    if (!address.trim()) return;
    const setGeocoding = mode === "create" ? setGeocodingAddress : setEditGeocoding;
    const setResult = mode === "create" ? setGeocodedResult : setEditGeoResult;
    setGeocoding(true);
    try {
      const res = await apiRequest("POST", "/api/media/geocode", { address: address.trim() });
      const data = await res.json();
      setResult(data);
      toast({ title: "Address verified", description: `GPS: ${data.lat.toFixed(5)}, ${data.lon.toFixed(5)}` });
    } catch (err) {
      toast({ title: "Could not verify address", description: apiErrorMessage(err, "Check the address and try again."), variant: "destructive" });
      setResult(null);
    } finally { setGeocoding(false); }
  };

  const createFolder = async () => {
    if (!newFolderName.trim()) {
      toast({ title: "Enter a folder name", variant: "destructive" });
      return;
    }
    setCreatingFolder(true);
    try {
      const res = await apiRequest("POST", "/api/media/folders", {
        name: newFolderName.trim(),
        clientAddress: newFolderAddress.trim() || null,
        lat: geocodedResult?.lat ?? null,
        lon: geocodedResult?.lon ?? null,
      });
      const folder = await res.json();
      setFolders(prev => [folder, ...prev]);
      setNewFolderName("");
      setNewFolderAddress("");
      setGeocodedResult(null);
      setShowNewFolder(false);
      toast({ title: "Folder created", description: folder.name });
    } catch (err: any) {
      toast({ title: "Failed to create folder", description: apiErrorMessage(err), variant: "destructive" });
    } finally { setCreatingFolder(false); }
  };

  const requestDeleteFolder = async (folder: Folder) => {
    setConfirmFolder({ folder, photoCount: activeFolderId === folder.id ? photos.length : null });
    if (activeFolderId === folder.id) return;
    // Count the photos that will go with the folder so the confirm can name them.
    try {
      const res = await fetch(`/api/media/folders/${folder.id}/photos`, { credentials: "include" });
      if (!res.ok) return;
      const list: Photo[] = await res.json();
      setConfirmFolder(prev => prev?.folder.id === folder.id ? { folder, photoCount: list.length } : prev);
    } catch { /* count stays unknown; the dialog says "every photo in it" */ }
  };

  const deleteFolder = async (folderId: number) => {
    setDeletingFolder(folderId);
    try {
      await apiRequest("DELETE", `/api/media/folders/${folderId}`);
      setFolders(prev => prev.filter(f => f.id !== folderId));
      if (activeFolderId === folderId) goBack();
      toast({ title: "Folder deleted" });
    } catch (err: any) {
      toast({ title: "Delete failed", description: apiErrorMessage(err), variant: "destructive" });
    } finally { setDeletingFolder(null); }
  };

  const updateFolder = async () => {
    if (!editingFolder || !editFolderName.trim()) return;
    setSavingEdit(true);
    try {
      const res = await apiRequest("PATCH", `/api/media/folders/${editingFolder.id}`, {
        name: editFolderName.trim(),
        clientAddress: editFolderAddress.trim() || null,
        lat: editGeoResult?.lat ?? editingFolder.lat,
        lon: editGeoResult?.lon ?? editingFolder.lon,
      });
      const updated = await res.json();
      setFolders(prev => prev.map(f => f.id === updated.id ? updated : f));
      if (activeFolder?.id === updated.id) setActiveFolder(updated);
      setEditingFolder(null);
      toast({ title: "Folder updated" });
    } catch (err: any) {
      toast({ title: "Update failed", description: apiErrorMessage(err), variant: "destructive" });
    } finally { setSavingEdit(false); }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!activeFolderId || !e.target.files?.length) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("folderId", String(activeFolderId));
      for (const file of Array.from(e.target.files)) {
        formData.append("photos", file);
      }
      const res = await fetch("/api/media/upload", { method: "POST", body: formData, credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message || "Upload failed");
      }
      const data = await res.json();
      setPhotos(prev => [...data.saved, ...prev]);
      toast({ title: "Photos uploaded", description: `${data.count} photo${data.count !== 1 ? "s" : ""} added.` });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const deletePhoto = async (photoId: number) => {
    try {
      await apiRequest("DELETE", `/api/media/photos/${photoId}`);
      setPhotos(prev => prev.filter(p => p.id !== photoId));
      setSelectedPhotos(prev => { const n = new Set(prev); n.delete(photoId); return n; });
      toast({ title: "Photo deleted" });
    } catch (err: any) {
      toast({ title: "Delete failed", description: apiErrorMessage(err), variant: "destructive" });
    }
  };

  const deleteSelected = async () => {
    const ids = Array.from(selectedPhotos);
    const deleted = new Set<number>();
    let firstError = "";
    for (const id of ids) {
      try {
        await apiRequest("DELETE", `/api/media/photos/${id}`);
        deleted.add(id);
      } catch (err) {
        if (!firstError) firstError = apiErrorMessage(err);
      }
    }
    // Only drop the photos the server actually deleted; failures stay selected.
    setPhotos(prev => prev.filter(p => !deleted.has(p.id)));
    setSelectedPhotos(new Set(ids.filter(id => !deleted.has(id))));
    const failed = ids.length - deleted.size;
    if (failed > 0) {
      toast({
        title: `${failed} of ${ids.length} photo${ids.length !== 1 ? "s" : ""} could not be deleted`,
        description: `${deleted.size} deleted. ${firstError}`,
        variant: "destructive",
      });
    } else {
      toast({ title: `${ids.length} photo${ids.length !== 1 ? "s" : ""} deleted` });
    }
  };

  const renamePhoto = async (photoId: number) => {
    if (!renameValue.trim()) return;
    try {
      const res = await apiRequest("PATCH", `/api/media/photos/${photoId}/rename`, { name: renameValue.trim() });
      const updated = await res.json();
      setPhotos(prev => prev.map(p => p.id === photoId ? { ...p, name: updated.name } : p));
      setRenamingPhoto(null);
      setRenameValue("");
    } catch (err: any) {
      toast({ title: "Rename failed", description: apiErrorMessage(err), variant: "destructive" });
    }
  };

  const toggleSelect = (id: number) => {
    setSelectedPhotos(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const selectAll = () => {
    if (selectedPhotos.size === filteredPhotos.length) {
      setSelectedPhotos(new Set());
    } else {
      setSelectedPhotos(new Set(filteredPhotos.map(p => p.id)));
    }
  };

  const filteredFolders = folders.filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase()));
  const filteredPhotos = photos.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase()));

  useEffect(() => {
    document.title = activeFolderId ? `${activeFolder?.name || "Folder"} — Media Library | ConstructHUB` : "Media Library | ConstructHUB";
  }, [activeFolderId, activeFolder]);

  const startEditFolder = (folder: Folder) => {
    setEditingFolder(folder);
    setEditFolderName(folder.name);
    setEditFolderAddress(folder.clientAddress || "");
    setEditGeoResult(folder.lat ? { lat: folder.lat, lon: folder.lon!, formattedAddress: folder.clientAddress || "" } : null);
  };

  return (
    <AppPage width="wide" testId="page-media-library">
      {activeFolderId ? (
        <header className="space-y-3">
          <button
            type="button"
            onClick={goBack}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            data-testid="button-back-folders"
          >
            <ArrowLeft className="h-3.5 w-3.5 rotate-180" aria-hidden="true" /> Folders
          </button>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight sm:text-[1.75rem] sm:leading-9 truncate" data-testid="heading-media-library">
                  {activeFolder?.name || "Folder"}
                </h1>
                {activeFolder?.clientAddress && (
                  <Badge variant="outline" className="text-[10px] gap-1 shrink-0">
                    <MapPin className="h-2.5 w-2.5" />
                    {activeFolder.lat ? "GPS embedded" : "Address set"}
                  </Badge>
                )}
              </div>
              {activeFolder?.clientAddress && (
                <p className="text-sm text-muted-foreground flex items-center gap-1">
                  <MapPin className="h-3 w-3 shrink-0" />
                  {activeFolder.clientAddress}
                  {activeFolder.lat && <span className="text-xs text-muted-foreground/70 ml-1">({activeFolder.lat.toFixed(4)}, {activeFolder.lon?.toFixed(4)})</span>}
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => activeFolder && startEditFolder(activeFolder)}
                data-testid="button-edit-folder"
              >
                <Pencil className="h-3.5 w-3.5 mr-1.5" />
                Edit
              </Button>
              <Button
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                data-testid="button-upload-photos"
              >
                {uploading ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-1.5" />}
                Upload photos
              </Button>
              <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleUpload} className="hidden" data-testid="input-upload-photos" />
            </div>
          </div>
        </header>
      ) : (
        <PageHeader
          title={<span data-testid="heading-media-library">Media library</span>}
          description="Project photo folders. Set a client address to embed GPS coordinates into photos."
          actions={
            <Button
              size="sm"
              onClick={() => setShowNewFolder(true)}
              data-testid="button-new-folder"
            >
              <FolderPlus className="h-3.5 w-3.5 mr-1.5" />
              New folder
            </Button>
          }
        />
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={activeFolderId ? "Search photos..." : "Search folders..."}
            className="pl-9 h-10"
            data-testid="input-search-media"
          />
        </div>
        {activeFolderId && (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-xl bg-muted p-1">
              <button
                onClick={() => setViewMode("grid")}
                className={`p-1.5 rounded-lg transition-colors ${viewMode === "grid" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                aria-label="Grid view"
                data-testid="button-view-grid"
              >
                <Grid3X3 className="h-4 w-4" />
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={`p-1.5 rounded-lg transition-colors ${viewMode === "list" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                aria-label="List view"
                data-testid="button-view-list"
              >
                <List className="h-4 w-4" />
              </button>
            </div>
            {filteredPhotos.length > 0 && (
              <Button variant="outline" size="sm" onClick={selectAll} data-testid="button-select-all">
                {selectedPhotos.size === filteredPhotos.length ? "Deselect all" : "Select all"}
              </Button>
            )}
            {selectedPhotos.size > 0 && (
              <Button variant="destructive" size="sm" onClick={() => setConfirmBulkDelete(true)} data-testid="button-delete-selected">
                <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                Delete ({selectedPhotos.size})
              </Button>
            )}
          </div>
        )}
      </div>

      {showNewFolder && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50" onClick={() => setShowNewFolder(false)}>
          <div className="bg-background border border-border rounded-xl shadow-2xl w-full max-w-md mx-4 p-5 space-y-4" onClick={e => e.stopPropagation()} data-testid="modal-new-folder">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold flex items-center gap-2">
                <FolderPlus className="h-4 w-4 text-muted-foreground" />
                New folder
              </h3>
              <button onClick={() => setShowNewFolder(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Folder name</Label>
                <Input
                  value={newFolderName}
                  onChange={e => setNewFolderName(e.target.value)}
                  placeholder="e.g. Smith Residence - Roof Replacement"
                  data-testid="input-folder-name"
                  autoFocus
                />
                <p className="text-[11px] text-muted-foreground">Use your client's name or project name for easy identification.</p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium flex items-center gap-1.5">
                  <MapPin className="h-3 w-3 text-muted-foreground" />
                  Client address (optional)
                </Label>
                <div className="flex gap-2">
                  <Input
                    value={newFolderAddress}
                    onChange={e => { setNewFolderAddress(e.target.value); setGeocodedResult(null); }}
                    placeholder="e.g. 123 Main St, Bellingham, WA 98225"
                    className="flex-1"
                    data-testid="input-folder-address"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => geocodeAddress(newFolderAddress, "create")}
                    disabled={geocodingAddress || !newFolderAddress.trim()}
                    aria-label="Verify address"
                    data-testid="button-verify-address"
                  >
                    {geocodingAddress ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Navigation className="h-3.5 w-3.5" />}
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  GPS coordinates are embedded into photos in this folder — just like when a phone takes a photo with location on. Google strips this data when photos are uploaded to a Business Profile, so it's for your own records and other sites, not a ranking boost.
                </p>
                {geocodedResult && (
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                    <div className="text-[11px]">
                      <p className="font-medium text-emerald-700 dark:text-emerald-300">{geocodedResult.formattedAddress}</p>
                      <p className="text-emerald-600/70 dark:text-emerald-400/70">GPS: {geocodedResult.lat.toFixed(6)}, {geocodedResult.lon.toFixed(6)}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <Button variant="outline" size="sm" className="flex-1" onClick={() => setShowNewFolder(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="flex-1"
                onClick={createFolder}
                disabled={creatingFolder || !newFolderName.trim()}
                data-testid="button-confirm-create-folder"
              >
                {creatingFolder ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FolderPlus className="h-4 w-4 mr-2" />}
                Create folder
              </Button>
            </div>
          </div>
        </div>
      )}

      {editingFolder && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50" onClick={() => setEditingFolder(null)}>
          <div className="bg-background border border-border rounded-xl shadow-2xl w-full max-w-md mx-4 p-5 space-y-4" onClick={e => e.stopPropagation()} data-testid="modal-edit-folder">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold flex items-center gap-2">
                <Pencil className="h-4 w-4 text-muted-foreground" />
                Edit folder
              </h3>
              <button onClick={() => setEditingFolder(null)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Folder name</Label>
                <Input value={editFolderName} onChange={e => setEditFolderName(e.target.value)} data-testid="input-edit-folder-name" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium flex items-center gap-1.5">
                  <MapPin className="h-3 w-3 text-muted-foreground" />
                  Client address
                </Label>
                <div className="flex gap-2">
                  <Input
                    value={editFolderAddress}
                    onChange={e => { setEditFolderAddress(e.target.value); setEditGeoResult(null); }}
                    placeholder="e.g. 123 Main St, City, State ZIP"
                    className="flex-1"
                    data-testid="input-edit-folder-address"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => geocodeAddress(editFolderAddress, "edit")}
                    disabled={editGeocoding || !editFolderAddress.trim()}
                    aria-label="Verify address"
                    data-testid="button-verify-edit-address"
                  >
                    {editGeocoding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Navigation className="h-3.5 w-3.5" />}
                  </Button>
                </div>
                {(editGeoResult || (editingFolder.lat && !editGeoResult)) && (
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                    <p className="text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                      GPS: {(editGeoResult?.lat ?? editingFolder.lat)?.toFixed(6)}, {(editGeoResult?.lon ?? editingFolder.lon)?.toFixed(6)}
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <Button variant="outline" size="sm" className="flex-1" onClick={() => setEditingFolder(null)}>Cancel</Button>
              <Button
                size="sm"
                className="flex-1"
                onClick={updateFolder}
                disabled={savingEdit || !editFolderName.trim()}
                data-testid="button-save-edit-folder"
              >
                {savingEdit ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
                Save changes
              </Button>
            </div>
          </div>
        </div>
      )}

      {previewPhoto && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80" onClick={() => setPreviewPhoto(null)} data-testid="modal-photo-preview">
          <div className="relative max-w-4xl max-h-[85vh] mx-4" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => setPreviewPhoto(null)}
              className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-white dark:bg-zinc-800 shadow-lg flex items-center justify-center hover:bg-gray-100 dark:hover:bg-zinc-700 z-10"
            >
              <X className="h-4 w-4" />
            </button>
            <img src={previewPhoto.url} alt={previewPhoto.name} className="max-w-full max-h-[85vh] rounded-lg shadow-2xl object-contain" />
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4 rounded-b-lg">
              <p className="text-white text-sm font-medium truncate">{previewPhoto.name}</p>
              {previewPhoto.size && <p className="text-white/60 text-xs">{formatFileSize(previewPhoto.size)}</p>}
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">Loading your library...</p>
        </div>
      ) : !activeFolderId ? (
        <>
          {filteredFolders.length === 0 && !searchQuery ? (
            <div data-testid="text-empty-state">
              <EmptyState
                icon={FolderOpen}
                title="No folders yet"
                description="Create your first folder to start organizing project photos. You can add a client address to embed GPS coordinates into every photo — Google strips EXIF on upload, so geotags don't promise a ranking boost."
                action={
                  <Button variant="outline" onClick={() => setShowNewFolder(true)} data-testid="button-empty-new-folder">
                    <FolderPlus className="h-4 w-4 mr-2" />
                    Create your first folder
                  </Button>
                }
              />
            </div>
          ) : filteredFolders.length === 0 ? (
            <EmptyState compact icon={Search} title={`No folders match "${searchQuery}"`} />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4" data-testid="folder-grid">
              {filteredFolders.map(folder => (
                <div
                  key={folder.id}
                  className="group relative cursor-pointer rounded-xl border bg-card transition-colors hover:border-primary/40 overflow-hidden"
                  onClick={() => openFolder(folder)}
                  data-testid={`folder-card-${folder.id}`}
                >
                  <div className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="h-10 w-10 rounded-xl bg-muted flex items-center justify-center shrink-0">
                        <FolderOpen className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-sm truncate" data-testid={`folder-name-${folder.id}`}>{folder.name}</h3>
                        <p className="text-[11px] text-muted-foreground mt-0.5">{formatDate(folder.createdAt)}</p>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={e => e.stopPropagation()}>
                          <button className={`p-1 rounded-md ${REVEAL_ON_HOVER} data-[state=open]:opacity-100 hover:bg-muted transition-all`} aria-label={`Folder actions for ${folder.name}`} data-testid={`folder-menu-${folder.id}`}>
                            <MoreVertical className="h-4 w-4 text-muted-foreground" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" onClick={e => e.stopPropagation()}>
                          <DropdownMenuItem onClick={() => startEditFolder(folder)}>
                            <Pencil className="h-3.5 w-3.5 mr-2" />
                            Edit folder
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-red-600 dark:text-red-400"
                            onClick={() => requestDeleteFolder(folder)}
                            disabled={deletingFolder === folder.id}
                            data-testid={`menu-delete-folder-${folder.id}`}
                          >
                            {deletingFolder === folder.id ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : <Trash2 className="h-3.5 w-3.5 mr-2" />}
                            Delete folder
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    {folder.clientAddress && (
                      <div className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <MapPin className="h-3 w-3 shrink-0" />
                        <span className="truncate">{folder.clientAddress}</span>
                        {folder.lat && (
                          <Badge variant="outline" className="text-[9px] px-1 py-0 ml-auto shrink-0 border-emerald-300 text-emerald-600 dark:border-emerald-700 dark:text-emerald-400">
                            GPS
                          </Badge>
                        )}
                      </div>
                    )}

                    <div className="mt-3 flex items-center justify-between">
                      <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <Image className="h-3 w-3" />
                        Click to view photos
                      </span>
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          {photosLoading ? (
            <div className="flex flex-col items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">Loading photos...</p>
            </div>
          ) : filteredPhotos.length === 0 && !searchQuery ? (
            <div data-testid="text-empty-photos">
              <EmptyState
                icon={ImagePlus}
                title="This folder is empty"
                description={`Upload photos directly, or process them in the Photo Optimizer and save them here.${activeFolder?.clientAddress ? " GPS coordinates from the folder's address will be embedded into photos." : ""}`}
                action={
                  <Button variant="outline" onClick={() => fileInputRef.current?.click()} data-testid="button-empty-upload">
                    <Upload className="h-4 w-4 mr-2" />
                    Upload photos
                  </Button>
                }
              />
            </div>
          ) : filteredPhotos.length === 0 ? (
            <EmptyState compact icon={Search} title={`No photos match "${searchQuery}"`} />
          ) : viewMode === "grid" ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3" data-testid="photo-grid">
              {filteredPhotos.map(photo => (
                <div
                  key={photo.id}
                  className={`group relative rounded-xl overflow-hidden border-2 transition-all duration-200 cursor-pointer ${
                    selectedPhotos.has(photo.id) ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-primary/40"
                  }`}
                  data-testid={`photo-card-${photo.id}`}
                >
                  <div className="aspect-square" onClick={() => setPreviewPhoto(photo)}>
                    <img src={photo.url} alt={photo.name} className="w-full h-full object-cover" loading="lazy" />
                  </div>

                  <button
                    onClick={e => { e.stopPropagation(); toggleSelect(photo.id); }}
                    className={`absolute top-2 left-2 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${
                      selectedPhotos.has(photo.id) ? "bg-primary border-primary text-primary-foreground" : `bg-white/80 dark:bg-zinc-800/80 border-white dark:border-zinc-600 ${REVEAL_ON_HOVER}`
                    }`}
                    aria-label={selectedPhotos.has(photo.id) ? `Deselect ${photo.name}` : `Select ${photo.name}`}
                    aria-pressed={selectedPhotos.has(photo.id)}
                    data-testid={`checkbox-photo-${photo.id}`}
                  >
                    {selectedPhotos.has(photo.id) && <Check className="h-3.5 w-3.5" />}
                  </button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        className={`absolute top-2 right-2 w-6 h-6 rounded-full bg-black/50 text-white flex items-center justify-center ${REVEAL_ON_HOVER} data-[state=open]:opacity-100 transition-opacity hover:bg-black/70`}
                        onClick={e => e.stopPropagation()}
                        aria-label={`Photo actions for ${photo.name}`}
                        data-testid={`photo-menu-${photo.id}`}
                      >
                        <MoreVertical className="h-3.5 w-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setPreviewPhoto(photo)}>
                        <Image className="h-3.5 w-3.5 mr-2" />
                        Preview
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => { setRenamingPhoto(photo.id); setRenameValue(photo.name); }}>
                        <Pencil className="h-3.5 w-3.5 mr-2" />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => {
                        const a = document.createElement("a");
                        a.href = photo.url;
                        a.download = photo.name;
                        a.click();
                      }}>
                        <Download className="h-3.5 w-3.5 mr-2" />
                        Download
                      </DropdownMenuItem>
                      <DropdownMenuItem className="text-red-600 dark:text-red-400" onClick={() => deletePhoto(photo.id)}>
                        <Trash2 className="h-3.5 w-3.5 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2 pt-6">
                    {renamingPhoto === photo.id ? (
                      <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                        <Input
                          value={renameValue}
                          onChange={e => setRenameValue(e.target.value)}
                          className="h-6 text-[10px] bg-white/90 dark:bg-zinc-800/90 text-foreground"
                          onKeyDown={e => { if (e.key === "Enter") renamePhoto(photo.id); if (e.key === "Escape") setRenamingPhoto(null); }}
                          autoFocus
                        />
                        <button onClick={() => renamePhoto(photo.id)} className="text-emerald-400 hover:text-emerald-300">
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => setRenamingPhoto(null)} className="text-red-400 hover:text-red-300">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <p className="text-white text-[10px] truncate">{photo.name}</p>
                    )}
                    {photo.size && <p className="text-white/50 text-[9px]">{formatFileSize(photo.size)}</p>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border bg-card divide-y" data-testid="photo-list">
              {filteredPhotos.map(photo => (
                <div
                  key={photo.id}
                  className={`flex items-center gap-3 px-4 py-2.5 transition-colors cursor-pointer ${
                    selectedPhotos.has(photo.id) ? "bg-primary/5" : "hover:bg-muted/50"
                  }`}
                  data-testid={`photo-list-item-${photo.id}`}
                >
                  <button onClick={() => toggleSelect(photo.id)} className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${selectedPhotos.has(photo.id) ? "bg-primary border-primary text-primary-foreground" : "border-border"}`}>
                    {selectedPhotos.has(photo.id) && <Check className="h-3 w-3" />}
                  </button>
                  <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0 cursor-pointer" onClick={() => setPreviewPhoto(photo)}>
                    <img src={photo.url} alt={photo.name} className="w-full h-full object-cover" loading="lazy" />
                  </div>
                  <div className="flex-1 min-w-0">
                    {renamingPhoto === photo.id ? (
                      <div className="flex gap-1.5 items-center">
                        <Input
                          value={renameValue}
                          onChange={e => setRenameValue(e.target.value)}
                          className="h-7 text-xs"
                          onKeyDown={e => { if (e.key === "Enter") renamePhoto(photo.id); if (e.key === "Escape") setRenamingPhoto(null); }}
                          autoFocus
                        />
                        <button onClick={() => renamePhoto(photo.id)} className="text-emerald-600"><Check className="h-4 w-4" /></button>
                        <button onClick={() => setRenamingPhoto(null)} className="text-red-500"><X className="h-4 w-4" /></button>
                      </div>
                    ) : (
                      <p className="text-sm truncate">{photo.name}</p>
                    )}
                    <p className="text-[11px] text-muted-foreground">{formatFileSize(photo.size)} · {formatDate(photo.createdAt)}</p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="p-1.5 rounded-md hover:bg-muted" data-testid={`photo-list-menu-${photo.id}`}>
                        <MoreVertical className="h-4 w-4 text-muted-foreground" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => { setRenamingPhoto(photo.id); setRenameValue(photo.name); }}>
                        <Pencil className="h-3.5 w-3.5 mr-2" />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => {
                        const a = document.createElement("a");
                        a.href = photo.url;
                        a.download = photo.name;
                        a.click();
                      }}>
                        <Download className="h-3.5 w-3.5 mr-2" />
                        Download
                      </DropdownMenuItem>
                      <DropdownMenuItem className="text-red-600 dark:text-red-400" onClick={() => deletePhoto(photo.id)}>
                        <Trash2 className="h-3.5 w-3.5 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </div>
          )}

          {!photosLoading && filteredPhotos.length > 0 && (
            <div className="flex items-center justify-between text-xs text-muted-foreground pt-2">
              <span>{filteredPhotos.length} photo{filteredPhotos.length !== 1 ? "s" : ""}</span>
              <span>{formatFileSize(filteredPhotos.reduce((sum, p) => sum + (p.size || 0), 0))} total</span>
            </div>
          )}
        </>
      )}

      <AlertDialog open={!!confirmFolder} onOpenChange={o => { if (!o) setConfirmFolder(null); }}>
        <AlertDialogContent data-testid="dialog-delete-folder">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete folder "{confirmFolder?.folder.name}"
              {confirmFolder?.photoCount != null && confirmFolder.photoCount > 0
                ? ` and its ${confirmFolder.photoCount} photo${confirmFolder.photoCount === 1 ? "" : "s"}`
                : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmFolder?.photoCount === 0
                ? "The folder is empty. This cannot be undone."
                : confirmFolder?.photoCount != null
                  ? `All ${confirmFolder.photoCount} photo${confirmFolder.photoCount === 1 ? "" : "s"} in it will be permanently deleted from your library and storage. This cannot be undone.`
                  : "Every photo in it will be permanently deleted from your library and storage. This cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-folder">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (confirmFolder) deleteFolder(confirmFolder.folder.id); setConfirmFolder(null); }}
              data-testid="button-confirm-delete-folder"
            >
              Delete folder
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmBulkDelete} onOpenChange={setConfirmBulkDelete}>
        <AlertDialogContent data-testid="dialog-delete-selected">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedPhotos.size} photo{selectedPhotos.size === 1 ? "" : "s"}?</AlertDialogTitle>
            <AlertDialogDescription>
              The selected photos will be permanently deleted from your library and storage. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-selected">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { void deleteSelected(); }}
              data-testid="button-confirm-delete-selected"
            >
              Delete photos
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppPage>
  );
}
