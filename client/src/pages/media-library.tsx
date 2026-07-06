import { useState, useCallback, useRef, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  FolderOpen, Plus, Trash2, Upload, Image, X, Loader2, Check,
  MapPin, Pencil, ArrowLeft, Download, Search, MoreVertical, ChevronRight,
  FolderPlus, ImagePlus, Navigation, CheckCircle2, Grid3X3, List,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
    } catch {
      toast({ title: "Could not verify address", description: "Check the address and try again.", variant: "destructive" });
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
      toast({ title: "Failed to create folder", description: err.message, variant: "destructive" });
    } finally { setCreatingFolder(false); }
  };

  const deleteFolder = async (folderId: number) => {
    setDeletingFolder(folderId);
    try {
      await apiRequest("DELETE", `/api/media/folders/${folderId}`);
      setFolders(prev => prev.filter(f => f.id !== folderId));
      if (activeFolderId === folderId) goBack();
      toast({ title: "Folder deleted" });
    } catch (err: any) {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
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
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
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
      if (!res.ok) throw new Error("Upload failed");
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
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    }
  };

  const deleteSelected = async () => {
    const ids = Array.from(selectedPhotos);
    for (const id of ids) {
      try {
        await apiRequest("DELETE", `/api/media/photos/${id}`);
      } catch {}
    }
    setPhotos(prev => prev.filter(p => !selectedPhotos.has(p.id)));
    setSelectedPhotos(new Set());
    toast({ title: `${ids.length} photo${ids.length !== 1 ? "s" : ""} deleted` });
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
      toast({ title: "Rename failed", description: err.message, variant: "destructive" });
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

  return (
    <div className="min-h-full p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6" data-testid="page-media-library">
      <div className="flex items-center gap-3">
        {activeFolderId && (
          <Button variant="ghost" size="sm" onClick={goBack} data-testid="button-back-folders">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5 text-amber-500 shrink-0" />
            <h1 className="text-xl font-bold truncate" data-testid="heading-media-library">
              {activeFolderId ? activeFolder?.name || "Folder" : "Media Library"}
            </h1>
            {activeFolderId && activeFolder?.clientAddress && (
              <Badge variant="outline" className="text-[10px] gap-1 shrink-0">
                <MapPin className="h-2.5 w-2.5" />
                {activeFolder.lat ? "GPS Embedded" : "Address Set"}
              </Badge>
            )}
          </div>
          {!activeFolderId && (
            <p className="text-sm text-muted-foreground mt-0.5">
              Organize your project photos into folders. Set a client address to embed GPS coordinates into photos.
            </p>
          )}
          {activeFolderId && activeFolder?.clientAddress && (
            <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
              <MapPin className="h-3 w-3 shrink-0" />
              {activeFolder.clientAddress}
              {activeFolder.lat && <span className="text-[10px] text-green-600 dark:text-green-400 ml-1">({activeFolder.lat.toFixed(4)}, {activeFolder.lon?.toFixed(4)})</span>}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {activeFolderId && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditingFolder(activeFolder);
                  setEditFolderName(activeFolder?.name || "");
                  setEditFolderAddress(activeFolder?.clientAddress || "");
                  setEditGeoResult(activeFolder?.lat ? { lat: activeFolder.lat, lon: activeFolder.lon!, formattedAddress: activeFolder.clientAddress || "" } : null);
                }}
                data-testid="button-edit-folder"
              >
                <Pencil className="h-3.5 w-3.5 mr-1.5" />
                Edit
              </Button>
              <Button
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="bg-amber-500 hover:bg-amber-600 text-white"
                data-testid="button-upload-photos"
              >
                {uploading ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-1.5" />}
                Upload Photos
              </Button>
              <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleUpload} className="hidden" data-testid="input-upload-photos" />
            </>
          )}
          {!activeFolderId && (
            <Button
              size="sm"
              onClick={() => setShowNewFolder(true)}
              className="bg-amber-500 hover:bg-amber-600 text-white"
              data-testid="button-new-folder"
            >
              <FolderPlus className="h-3.5 w-3.5 mr-1.5" />
              New Folder
            </Button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={activeFolderId ? "Search photos..." : "Search folders..."}
            className="pl-9 h-9"
            data-testid="input-search-media"
          />
        </div>
        {activeFolderId && (
          <div className="flex items-center gap-1 border border-border rounded-lg p-0.5">
            <button
              onClick={() => setViewMode("grid")}
              className={`p-1.5 rounded-md transition-colors ${viewMode === "grid" ? "bg-amber-500/10 text-amber-600" : "text-muted-foreground hover:text-foreground"}`}
              data-testid="button-view-grid"
            >
              <Grid3X3 className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`p-1.5 rounded-md transition-colors ${viewMode === "list" ? "bg-amber-500/10 text-amber-600" : "text-muted-foreground hover:text-foreground"}`}
              data-testid="button-view-list"
            >
              <List className="h-4 w-4" />
            </button>
          </div>
        )}
        {activeFolderId && filteredPhotos.length > 0 && (
          <Button variant="outline" size="sm" onClick={selectAll} data-testid="button-select-all">
            {selectedPhotos.size === filteredPhotos.length ? "Deselect All" : "Select All"}
          </Button>
        )}
        {selectedPhotos.size > 0 && (
          <Button variant="destructive" size="sm" onClick={deleteSelected} data-testid="button-delete-selected">
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            Delete ({selectedPhotos.size})
          </Button>
        )}
      </div>

      {showNewFolder && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50" onClick={() => setShowNewFolder(false)}>
          <div className="bg-background border border-border rounded-xl shadow-2xl w-full max-w-md mx-4 p-5 space-y-4" onClick={e => e.stopPropagation()} data-testid="modal-new-folder">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold flex items-center gap-2">
                <FolderPlus className="h-4 w-4 text-amber-500" />
                Create New Folder
              </h3>
              <button onClick={() => setShowNewFolder(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Folder Name</Label>
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
                  <MapPin className="h-3 w-3 text-amber-500" />
                  Client Address (optional)
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
                    data-testid="button-verify-address"
                  >
                    {geocodingAddress ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Navigation className="h-3.5 w-3.5" />}
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  GPS coordinates will be embedded into photos in this folder — just like when a phone takes a photo with location on. This helps Google associate your photos with the job site.
                </p>
                {geocodedResult && (
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800">
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />
                    <div className="text-[11px]">
                      <p className="font-medium text-green-700 dark:text-green-300">{geocodedResult.formattedAddress}</p>
                      <p className="text-green-600/70 dark:text-green-400/70">GPS: {geocodedResult.lat.toFixed(6)}, {geocodedResult.lon.toFixed(6)}</p>
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
                className="flex-1 bg-amber-500 hover:bg-amber-600 text-white"
                onClick={createFolder}
                disabled={creatingFolder || !newFolderName.trim()}
                data-testid="button-confirm-create-folder"
              >
                {creatingFolder ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FolderPlus className="h-4 w-4 mr-2" />}
                Create Folder
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
                <Pencil className="h-4 w-4 text-amber-500" />
                Edit Folder
              </h3>
              <button onClick={() => setEditingFolder(null)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Folder Name</Label>
                <Input value={editFolderName} onChange={e => setEditFolderName(e.target.value)} data-testid="input-edit-folder-name" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium flex items-center gap-1.5">
                  <MapPin className="h-3 w-3 text-amber-500" />
                  Client Address
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
                    data-testid="button-verify-edit-address"
                  >
                    {editGeocoding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Navigation className="h-3.5 w-3.5" />}
                  </Button>
                </div>
                {(editGeoResult || (editingFolder.lat && !editGeoResult)) && (
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800">
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />
                    <p className="text-[11px] font-medium text-green-700 dark:text-green-300">
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
                className="flex-1 bg-amber-500 hover:bg-amber-600 text-white"
                onClick={updateFolder}
                disabled={savingEdit || !editFolderName.trim()}
                data-testid="button-save-edit-folder"
              >
                {savingEdit ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
                Save Changes
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
          <Loader2 className="h-8 w-8 animate-spin text-amber-500 mb-3" />
          <p className="text-sm text-muted-foreground">Loading your library...</p>
        </div>
      ) : !activeFolderId ? (
        <>
          {filteredFolders.length === 0 && !searchQuery ? (
            <Card className="p-10 text-center" style={{ boxShadow: "var(--shadow-sm)" }}>
              <div className="w-16 h-16 rounded-2xl bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
                <FolderOpen className="h-8 w-8 text-amber-500" />
              </div>
              <h3 className="font-semibold text-lg mb-1" data-testid="text-empty-state">No folders yet</h3>
              <p className="text-sm text-muted-foreground max-w-md mx-auto mb-5">
                Create your first folder to start organizing project photos. You can add a client address to embed GPS coordinates into every photo — boosting your local SEO just like a phone does when location is enabled.
              </p>
              <Button
                onClick={() => setShowNewFolder(true)}
                className="bg-amber-500 hover:bg-amber-600 text-white"
                data-testid="button-empty-new-folder"
              >
                <FolderPlus className="h-4 w-4 mr-2" />
                Create Your First Folder
              </Button>
            </Card>
          ) : filteredFolders.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Search className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No folders match "{searchQuery}"</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4" data-testid="folder-grid">
              {filteredFolders.map(folder => (
                <Card
                  key={folder.id}
                  className="group relative cursor-pointer hover:border-amber-400 dark:hover:border-amber-600 transition-all duration-200 hover:shadow-md overflow-hidden"
                  style={{ boxShadow: "var(--shadow-sm)" }}
                  onClick={() => openFolder(folder)}
                  data-testid={`folder-card-${folder.id}`}
                >
                  <div className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0 group-hover:bg-amber-500/20 transition-colors">
                        <FolderOpen className="h-5 w-5 text-amber-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-sm truncate" data-testid={`folder-name-${folder.id}`}>{folder.name}</h3>
                        <p className="text-[11px] text-muted-foreground mt-0.5">{formatDate(folder.createdAt)}</p>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={e => e.stopPropagation()}>
                          <button className="p-1 rounded-md opacity-0 group-hover:opacity-100 hover:bg-muted transition-all" data-testid={`folder-menu-${folder.id}`}>
                            <MoreVertical className="h-4 w-4 text-muted-foreground" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" onClick={e => e.stopPropagation()}>
                          <DropdownMenuItem onClick={() => {
                            setEditingFolder(folder);
                            setEditFolderName(folder.name);
                            setEditFolderAddress(folder.clientAddress || "");
                            setEditGeoResult(folder.lat ? { lat: folder.lat, lon: folder.lon!, formattedAddress: folder.clientAddress || "" } : null);
                          }}>
                            <Pencil className="h-3.5 w-3.5 mr-2" />
                            Edit Folder
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-red-600 dark:text-red-400"
                            onClick={() => deleteFolder(folder.id)}
                            disabled={deletingFolder === folder.id}
                          >
                            {deletingFolder === folder.id ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : <Trash2 className="h-3.5 w-3.5 mr-2" />}
                            Delete Folder
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    {folder.clientAddress && (
                      <div className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <MapPin className="h-3 w-3 text-amber-500 shrink-0" />
                        <span className="truncate">{folder.clientAddress}</span>
                        {folder.lat && (
                          <Badge variant="outline" className="text-[9px] px-1 py-0 ml-auto shrink-0 border-green-300 text-green-600 dark:border-green-700 dark:text-green-400">
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
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-amber-500 transition-colors" />
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          {photosLoading ? (
            <div className="flex flex-col items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-amber-500 mb-2" />
              <p className="text-sm text-muted-foreground">Loading photos...</p>
            </div>
          ) : filteredPhotos.length === 0 && !searchQuery ? (
            <Card className="p-10 text-center" style={{ boxShadow: "var(--shadow-sm)" }}>
              <div className="w-16 h-16 rounded-2xl bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
                <ImagePlus className="h-8 w-8 text-amber-500" />
              </div>
              <h3 className="font-semibold text-lg mb-1" data-testid="text-empty-photos">This folder is empty</h3>
              <p className="text-sm text-muted-foreground max-w-md mx-auto mb-5">
                Upload photos directly, or process them in the Photo Optimizer and save them here.
                {activeFolder?.clientAddress && " GPS coordinates from the folder's address will be embedded into photos."}
              </p>
              <Button
                onClick={() => fileInputRef.current?.click()}
                className="bg-amber-500 hover:bg-amber-600 text-white"
                data-testid="button-empty-upload"
              >
                <Upload className="h-4 w-4 mr-2" />
                Upload Photos
              </Button>
            </Card>
          ) : filteredPhotos.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Search className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No photos match "{searchQuery}"</p>
            </div>
          ) : viewMode === "grid" ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3" data-testid="photo-grid">
              {filteredPhotos.map(photo => (
                <div
                  key={photo.id}
                  className={`group relative rounded-xl overflow-hidden border-2 transition-all duration-200 cursor-pointer ${
                    selectedPhotos.has(photo.id) ? "border-amber-500 ring-2 ring-amber-500/30 shadow-md" : "border-border hover:border-amber-300 dark:hover:border-amber-600 hover:shadow-md"
                  }`}
                  data-testid={`photo-card-${photo.id}`}
                >
                  <div className="aspect-square" onClick={() => setPreviewPhoto(photo)}>
                    <img src={photo.url} alt={photo.name} className="w-full h-full object-cover" loading="lazy" />
                  </div>

                  <button
                    onClick={e => { e.stopPropagation(); toggleSelect(photo.id); }}
                    className={`absolute top-2 left-2 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${
                      selectedPhotos.has(photo.id) ? "bg-amber-500 border-amber-500 text-white" : "bg-white/80 dark:bg-zinc-800/80 border-white dark:border-zinc-600 opacity-0 group-hover:opacity-100"
                    }`}
                    data-testid={`checkbox-photo-${photo.id}`}
                  >
                    {selectedPhotos.has(photo.id) && <Check className="h-3.5 w-3.5" />}
                  </button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/50 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70"
                        onClick={e => e.stopPropagation()}
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
                        <button onClick={() => renamePhoto(photo.id)} className="text-green-400 hover:text-green-300">
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
            <div className="space-y-1" data-testid="photo-list">
              {filteredPhotos.map(photo => (
                <div
                  key={photo.id}
                  className={`flex items-center gap-3 p-2 rounded-lg transition-colors cursor-pointer ${
                    selectedPhotos.has(photo.id) ? "bg-amber-500/10 border border-amber-500/30" : "hover:bg-muted border border-transparent"
                  }`}
                  data-testid={`photo-list-item-${photo.id}`}
                >
                  <button onClick={() => toggleSelect(photo.id)} className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${selectedPhotos.has(photo.id) ? "bg-amber-500 border-amber-500 text-white" : "border-border"}`}>
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
                        <button onClick={() => renamePhoto(photo.id)} className="text-green-600"><Check className="h-4 w-4" /></button>
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
            <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t border-border/50">
              <span>{filteredPhotos.length} photo{filteredPhotos.length !== 1 ? "s" : ""}</span>
              <span>{formatFileSize(filteredPhotos.reduce((sum, p) => sum + (p.size || 0), 0))} total</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}