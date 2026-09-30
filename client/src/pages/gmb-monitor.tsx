import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import type { GmbListing, GmbEditHistory } from "@shared/schema";
import {
  Eye, Search, Plus, Trash2, RefreshCw, Building2, Phone,
  Globe, MapPin, Star, Clock, AlertTriangle, CheckCircle2,
  ChevronDown, ChevronUp, Loader2, Image, MessageSquare, History,
  Sparkles, Copy, AlertOctagon,
} from "lucide-react";

function fieldLabel(field: string): string {
  const labels: Record<string, string> = {
    businessName: "Business Name",
    address: "Address",
    phone: "Phone Number",
    website: "Website",
    category: "Category",
    hours: "Business Hours",
    photoCount: "Photo Count",
    rating: "Rating",
    reviewCount: "Review Count",
  };
  return labels[field] || field;
}

function fieldIcon(field: string) {
  const icons: Record<string, typeof Building2> = {
    businessName: Building2,
    address: MapPin,
    phone: Phone,
    website: Globe,
    category: Star,
    hours: Clock,
    photoCount: Image,
    rating: Star,
    reviewCount: MessageSquare,
  };
  return icons[field] || AlertTriangle;
}

function EditHistoryItem({ edit }: { edit: GmbEditHistory }) {
  const Icon = fieldIcon(edit.fieldChanged);
  return (
    <div className="flex items-start gap-3 py-3 border-b border-border/40 last:border-0" data-testid={`edit-history-${edit.id}`}>
      <div className="mt-0.5 h-8 w-8 rounded-lg bg-orange-500/10 flex items-center justify-center shrink-0">
        <Icon className="h-4 w-4 text-orange-400" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium">{fieldLabel(edit.fieldChanged)}</span>
          <Badge variant="outline" className="text-[10px] py-0">changed</Badge>
        </div>
        <div className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="text-xs">
            <span className="text-muted-foreground">Before: </span>
            <span className="text-red-400 line-through">{edit.oldValue || "(empty)"}</span>
          </div>
          <div className="text-xs">
            <span className="text-muted-foreground">After: </span>
            <span className="text-emerald-400">{edit.newValue || "(empty)"}</span>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1">
          {edit.detectedAt ? new Date(edit.detectedAt).toLocaleString() : ""}
        </p>
      </div>
    </div>
  );
}

function ListingCard({ listing }: { listing: GmbListing }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);

  const { data: history, isLoading: historyLoading } = useQuery<GmbEditHistory[]>({
    queryKey: ["/api/gmb/listings", listing.id, "history"],
    enabled: expanded,
  });

  const [confirmDelete, setConfirmDelete] = useState(false);
  // The first check only records a baseline (the server compares nothing until
  // lastCheckedAt is set), so it must not be reported as "no changes".
  const isBaseline = !listing.lastCheckedAt;

  const checkMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/gmb/listings/${listing.id}/check`);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/gmb/listings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/gmb/listings", listing.id, "history"] });
      const changeCount = data.changes?.length || 0;
      // The server says whether this check was the first (baseline); older servers omit it.
      toast((data.baseline ?? isBaseline)
        ? { title: "Baseline captured from Google", description: "Future checks compare against this snapshot." }
        : {
            title: changeCount > 0 ? `${changeCount} change(s) detected` : "No changes detected",
            description: changeCount > 0 ? "Changes have been logged to edit history." : "Your listing matches the current Google data.",
          });
    },
    onError: (err: Error) => {
      toast({ title: "Check failed", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async (isMonitoring: boolean) => {
      const res = await apiRequest("PATCH", `/api/gmb/listings/${listing.id}`, { isMonitoring });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gmb/listings"] });
    },
    onError: (err: Error) => {
      toast({ title: "Could not update listing", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/gmb/listings/${listing.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gmb/listings"] });
      toast({ title: "Listing removed" });
    },
    onError: (err: Error) => {
      toast({ title: "Could not remove listing", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  return (
    <Card className="p-4 hover:border-primary/20 transition-colors" data-testid={`listing-card-${listing.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
            <Building2 className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-sm truncate">{listing.businessName}</h3>
            {listing.address && (
              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                <MapPin className="h-3 w-3 shrink-0" /> <span className="truncate">{listing.address}</span>
              </p>
            )}
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              {listing.phone && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Phone className="h-3 w-3" /> {listing.phone}
                </span>
              )}
              {listing.rating && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Star className="h-3 w-3 text-yellow-400" /> {listing.rating} ({listing.reviewCount})
                </span>
              )}
              {listing.category && (
                <Badge variant="outline" className="text-[10px] py-0">{listing.category}</Badge>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1.5">
            <Label htmlFor={`switch-monitor-${listing.id}`} className="text-[10px] leading-tight text-right text-muted-foreground max-w-[4.5rem] sm:max-w-none">Include in Check All</Label>
            <Switch
              id={`switch-monitor-${listing.id}`}
              checked={listing.isMonitoring}
              onCheckedChange={(val) => toggleMutation.mutate(val)}
              disabled={toggleMutation.isPending}
              data-testid={`switch-monitor-${listing.id}`}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-border/40">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1.5"
          onClick={() => checkMutation.mutate()}
          disabled={checkMutation.isPending}
          data-testid={`button-check-${listing.id}`}
        >
          {checkMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Check Now
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs gap-1.5"
          onClick={() => setExpanded(!expanded)}
          data-testid={`button-history-${listing.id}`}
        >
          <History className="h-3 w-3" />
          Edit History
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </Button>
        <div className="flex-1" />
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0 text-destructive hover:text-destructive"
          onClick={() => setConfirmDelete(true)}
          disabled={deleteMutation.isPending}
          aria-label={`Remove ${listing.businessName}`}
          data-testid={`button-delete-${listing.id}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
        <span className="text-[10px] text-muted-foreground whitespace-nowrap" data-testid={`text-last-checked-${listing.id}`}>
          {listing.lastCheckedAt
            ? `Last checked: ${new Date(listing.lastCheckedAt).toLocaleDateString()}`
            : "Not checked yet"}
        </span>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent data-testid={`dialog-delete-listing-${listing.id}`}>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {listing.businessName}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the listing from ConstructHUB together with its edit history. Nothing changes on Google. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid={`button-cancel-delete-${listing.id}`}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteMutation.mutate()}
              data-testid={`button-confirm-delete-${listing.id}`}
            >
              Remove listing
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {expanded && (
        <div className="mt-3 pt-2 border-t border-border/40">
          {historyLoading ? (
            <div className="flex items-center gap-2 py-4 justify-center text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading history...
            </div>
          ) : history && history.length > 0 ? (
            <div className="max-h-64 overflow-y-auto">
              {history.map(edit => (
                <EditHistoryItem key={edit.id} edit={edit} />
              ))}
            </div>
          ) : (
            <div className="text-center py-4">
              <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-emerald-400/50" />
              <p className="text-xs text-muted-foreground">No edits detected yet</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {listing.lastCheckedAt
                  ? 'Click "Check Now" to compare the listing against Google again'
                  : 'Click "Check Now" to capture a baseline; later checks compare against it'}
              </p>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function ReviewResponseTool() {
  const { toast } = useToast();
  const [reviewText, setReviewText] = useState("");
  const [reviewerName, setReviewerName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [tone, setTone] = useState("professional");
  const [generatedResponse, setGeneratedResponse] = useState("");
  const [customEdit, setCustomEdit] = useState("");
  const [showWarning, setShowWarning] = useState(false);

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/gmb/review-response", {
        reviewText,
        businessName,
        tone,
        reviewerName,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setGeneratedResponse(data.response);
      setCustomEdit(data.response);
      setShowWarning(false);
    },
    onError: (err: Error) => {
      // A 5xx here means the AI provider call failed, not the user's input.
      const serverFault = /^5\d\d:/.test(err.message);
      toast({
        title: serverFault ? "AI responses are unavailable right now" : "Generation failed",
        description: serverFault ? "Please try again later." : apiErrorMessage(err),
        variant: "destructive",
      });
    },
  });

  const handleCustomEditChange = (value: string) => {
    setCustomEdit(value);
    const rudeWords = ["idiot", "stupid", "liar", "fraud", "scam", "incompetent", "pathetic", "worthless", "joke", "trash", "garbage", "terrible", "horrible", "worst", "hate", "disgusting"];
    const hasRudeContent = rudeWords.some(w => value.toLowerCase().includes(w));
    setShowWarning(hasRudeContent);
  };

  const copyToClipboard = async () => {
    // Only confirm a copy the browser actually performed; clipboard access can be blocked.
    try {
      await navigator.clipboard.writeText(customEdit || generatedResponse);
      toast({ title: "Copied to clipboard", description: "Paste this response into your Google review reply." });
    } catch {
      toast({ title: "Copy failed", description: "Your browser blocked clipboard access. Select the response text and copy it manually.", variant: "destructive" });
    }
  };

  return (
    <Card className="p-4 border-[#4A6CF7]/20 bg-[#4A6CF7]/[0.02]" data-testid="card-review-response-tool">
      <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-[#4A6CF7]" /> AI Review Response Generator
      </h3>
      <p className="text-xs text-muted-foreground mb-4">
        Paste a customer review and we'll generate a professional, SEO-friendly response. Remember: NEVER respond with aggression — even if the customer is wrong, other potential clients are reading.
      </p>

      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs mb-1 block">Business Name</Label>
            <Input
              placeholder="Your business name"
              value={businessName}
              onChange={e => setBusinessName(e.target.value)}
              className="h-8 text-sm"
              data-testid="input-review-business"
            />
          </div>
          <div>
            <Label className="text-xs mb-1 block">Reviewer Name (optional)</Label>
            <Input
              placeholder="Customer's name"
              value={reviewerName}
              onChange={e => setReviewerName(e.target.value)}
              className="h-8 text-sm"
              data-testid="input-reviewer-name"
            />
          </div>
        </div>

        <div>
          <Label className="text-xs mb-1 block">Customer Review</Label>
          <Textarea
            placeholder="Paste the customer review here..."
            value={reviewText}
            onChange={e => setReviewText(e.target.value)}
            rows={3}
            className="text-sm"
            data-testid="textarea-review-text"
          />
        </div>

        <div className="flex items-center gap-3">
          <div className="flex-1">
            <Label className="text-xs mb-1 block">Response Tone</Label>
            <Select value={tone} onValueChange={setTone}>
              <SelectTrigger className="h-8 text-sm" data-testid="select-tone">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="professional">Professional</SelectItem>
                <SelectItem value="empathetic">Empathetic (for negative reviews)</SelectItem>
                <SelectItem value="grateful">Grateful (for positive reviews)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            size="sm"
            className="mt-4 gap-1.5 bg-[#4A6CF7] hover:bg-[#3B5CE5]"
            onClick={() => generateMutation.mutate()}
            disabled={!reviewText.trim() || generateMutation.isPending}
            data-testid="button-generate-response"
          >
            {generateMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            Generate Response
          </Button>
        </div>

        {generatedResponse && (
          <div className="space-y-2 mt-2 pt-3 border-t border-border/40">
            <Label className="text-xs mb-1 block">Generated Response (edit if needed)</Label>
            <Textarea
              value={customEdit}
              onChange={e => handleCustomEditChange(e.target.value)}
              rows={4}
              className="text-sm"
              data-testid="textarea-generated-response"
            />

            {showWarning && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20" data-testid="warning-rude-content">
                <AlertOctagon className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-red-500">Warning: Potentially aggressive language detected</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Rude or condescending responses ALWAYS hurt your business. Even if the customer is wrong, other clients don't know the whole story — you'll be the bad guy. Please reconsider your wording. Our AI-generated response is designed to be professional and SEO-friendly.
                  </p>
                </div>
              </div>
            )}

            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs"
              onClick={copyToClipboard}
              data-testid="button-copy-response"
            >
              <Copy className="h-3 w-3" /> Copy to Clipboard
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

export default function GmbMonitorPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);

  const { data: listings, isLoading } = useQuery<GmbListing[]>({
    queryKey: ["/api/gmb/listings"],
  });

  const addMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/gmb/listings", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gmb/listings"] });
      setSearchResults([]);
      setSearchQuery("");
      toast({ title: "Listing added", description: "Click Check Now on the listing to capture a baseline from Google." });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to add", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  const [searchError, setSearchError] = useState("");

  const handleSearch = async () => {
    if (searchQuery.trim().length < 2) {
      setSearchError("Enter at least 2 characters.");
      return;
    }
    setSearchError("");
    setIsSearching(true);
    setSearchResults([]);
    try {
      const res = await apiRequest("POST", "/api/photos/business-search", { query: searchQuery });
      const data = await res.json();
      if (data.results?.length > 0) {
        setSearchResults(data.results);
      } else {
        toast({ title: "No results", description: "Try a different search." });
      }
    } catch (err) {
      toast({ title: "Search failed", description: apiErrorMessage(err), variant: "destructive" });
    } finally {
      setIsSearching(false);
    }
  };

  const checkAllMutation = useMutation({
    mutationFn: async () => {
      const active = (listings ?? []).filter(l => l.isMonitoring);
      let totalChanges = 0;
      let baselines = 0;
      let failed = 0;
      let firstError = "";
      for (const listing of active) {
        try {
          const res = await apiRequest("POST", `/api/gmb/listings/${listing.id}/check`);
          const data = await res.json();
          if (data.baseline ?? !listing.lastCheckedAt) baselines++;
          totalChanges += data.changes?.length || 0;
        } catch (err) {
          failed++;
          if (!firstError) firstError = `${listing.businessName}: ${apiErrorMessage(err)}`;
        }
      }
      return { total: active.length, totalChanges, baselines, failed, firstError };
    },
    onSuccess: ({ total, totalChanges, baselines, failed, firstError }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/gmb/listings"] });
      const checked = total - failed;
      const parts: string[] = [];
      if (totalChanges) parts.push(`${totalChanges} change(s) detected.`);
      if (baselines) parts.push(`${baselines} listing(s) got their first baseline.`);
      if (failed > 0) {
        // Never report "no changes" for a listing that was not actually checked.
        if (checked > 0 && !totalChanges) parts.push(`No changes in the ${checked} checked.`);
        toast({
          title: `${failed} of ${total} listing${total === 1 ? "" : "s"} could not be checked`,
          description: [...parts, firstError].join(" "),
          variant: "destructive",
        });
        return;
      }
      toast({
        title: `${total} listing${total === 1 ? "" : "s"} checked`,
        description: parts.length ? parts.join(" ") : "No changes detected across the checked listings.",
      });
    },
    onError: (err: Error) => {
      toast({ title: "Check All failed", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  const monitoredCount = listings?.filter(l => l.isMonitoring).length ?? 0;

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight flex items-center gap-2" data-testid="text-page-title">
              <Eye className="h-5 w-5 text-primary" />
              GMB Edit Monitor
            </h1>
            <div className="h-1 w-16 rounded-full bg-gradient-to-r from-[#4A6CF7] to-[#F97316] mt-1" />
            <p className="text-sm text-muted-foreground mt-1 max-w-lg">
              Your Google Business listing can be edited by anyone — Google, competitors, or random users. Check your listing against Google's public data whenever you like, and keep a history of every change a check finds. Checks run only when you click Check Now or Check All — there are no automatic checks or alerts.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {monitoredCount > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 text-xs"
                onClick={() => checkAllMutation.mutate()}
                disabled={checkAllMutation.isPending}
                data-testid="button-check-all"
              >
                {checkAllMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                Check All ({monitoredCount})
              </Button>
            )}
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => setShowAddForm(!showAddForm)}
              data-testid="button-add-listing"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Business
            </Button>
          </div>
        </div>

        {showAddForm && (
          <Card className="p-4 border-primary/20 bg-primary/[0.02]">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Search className="h-4 w-4" /> Search Google My Business
            </h3>
            <div className="flex gap-2">
              <Input
                placeholder="Business name, address, or Google Maps URL..."
                value={searchQuery}
                onChange={e => { setSearchQuery(e.target.value); if (searchError) setSearchError(""); }}
                onKeyDown={e => e.key === "Enter" && handleSearch()}
                aria-invalid={!!searchError}
                aria-describedby={searchError ? "gmb-search-error" : undefined}
                data-testid="input-gmb-search"
              />
              <Button
                onClick={handleSearch}
                disabled={isSearching}
                data-testid="button-gmb-search"
              >
                {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            </div>
            {searchError && (
              <p id="gmb-search-error" role="alert" className="text-xs text-destructive mt-1.5" data-testid="text-gmb-search-error">{searchError}</p>
            )}
            {searchResults.length > 0 && (
              <div className="mt-3 space-y-2 max-h-64 overflow-y-auto">
                {searchResults.map((r: any, i: number) => (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border/40 hover:border-primary/30 transition-colors cursor-pointer"
                    onClick={() => addMutation.mutate({
                      placeId: r.placeId,
                      businessName: r.companyName || r.name,
                      address: r.address,
                      phone: r.phone,
                      website: r.website,
                      category: r.category,
                    })}
                    data-testid={`search-result-${i}`}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{r.companyName || r.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{r.address}</p>
                    </div>
                    <Button size="sm" variant="ghost" className="shrink-0 h-7 text-xs gap-1">
                      <Plus className="h-3 w-3" /> Add
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        <ReviewResponseTool />

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : listings && listings.length > 0 ? (
          <div className="space-y-3">
            {listings.map(listing => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </div>
        ) : (
          <Card className="p-12 text-center">
            <Eye className="h-12 w-12 mx-auto mb-4 text-muted-foreground/30" />
            <h3 className="text-lg font-semibold mb-1">No listings added yet</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Add your Google Business listings, then use Check Now to spot changes like name edits, address updates, photo count changes, and more.
            </p>
            <Button onClick={() => setShowAddForm(true)} data-testid="button-add-first">
              <Plus className="h-4 w-4 mr-2" /> Add Your First Business
            </Button>
          </Card>
        )}
      </div>
    </div>
  );
}
