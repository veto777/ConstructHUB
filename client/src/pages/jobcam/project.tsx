/**
 * /crm/projects/:id/jobcam — one project's JobCam feed (grid + day timeline),
 * filters, bulk actions and the share links (gallery / live timeline).
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useRoute } from "wouter";
import { ArrowLeft, Camera, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CrmPage, ErrorCard, StatusPill, statusTone } from "@/components/crm-ui";
import { GooglePill } from "@/components/google";
import { JobcamFeed } from "@/components/jobcam/feed";
import { ShareDialog } from "@/components/jobcam/share-dialog";
import { bootJobcamQueue } from "@/lib/jobcam-queue";
import { Loader2 } from "lucide-react";

export default function JobcamProjectPage() {
  const [, params] = useRoute("/crm/projects/:id/jobcam");
  const id = params?.id;
  const { data: me } = useQuery<any>({ queryKey: ["/api/crm/me"] });
  const { data: project, isLoading, isError } = useQuery<any>({ queryKey: [`/api/crm/projects/${id}`], enabled: !!id, retry: false });
  const [share, setShare] = useState<{ open: boolean; mediaIds: string[] }>({ open: false, mediaIds: [] });
  useEffect(() => { bootJobcamQueue(); }, []);
  useEffect(() => { if (project?.name) document.title = `JobCam · ${project.name}`; }, [project?.name]);
  // Sharing needs JobCam on the plan too (the feed below shows the upgrade card without it).
  const canManage = (me?.permissions?.manageJobs === true || me?.permissions?.manageCustomers === true) && me?.crm?.jobcam !== false;

  if (!id) return null;
  if (isLoading) return <div className="flex justify-center p-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (isError || !project) {
    return (
      <ErrorCard title="Project not found" description="It may belong to a project manager other than you, or it's been removed.">
        <Link href="/crm/jobcam"><Button variant="outline" size="sm"><ArrowLeft className="h-4 w-4 mr-1" /> JobCam</Button></Link>
      </ErrorCard>
    );
  }
  const address = [project.addressLine1, [project.city, project.state].filter(Boolean).join(", "), project.postalCode].filter(Boolean).join(" · ");
  return (
    <CrmPage wide>
      <div className="space-y-2">
        <Link href={`/crm/projects/${id}`}>
          <Button variant="ghost" size="sm" className="-ml-2"><ArrowLeft className="h-4 w-4 mr-1" /> {project.name}</Button>
        </Link>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2"><Camera className="h-6 w-6 text-primary" /> JobCam</h1>
          <StatusPill tone={statusTone(project.status)}>{project.stageLabel ?? project.status}</StatusPill>
        </div>
        <div className="text-sm text-muted-foreground">{[project.number, address].filter(Boolean).join(" · ")}</div>
      </div>
      <JobcamFeed projectId={id} title={project.name} canManage={canManage} memberId={me?.member?.id ?? null}
        onShare={canManage ? (ids) => setShare({ open: true, mediaIds: ids }) : undefined}
        actions={canManage ? <GooglePill size="sm" icon={Share2} label="Share" onClick={() => setShare({ open: true, mediaIds: [] })} testId="jobcam-share-open" /> : null} />
      {canManage && <ShareDialog projectId={id} customerId={project.customerId} open={share.open} mediaIds={share.mediaIds} onOpenChange={(o: boolean) => setShare((s) => ({ ...s, open: o }))} />}
    </CrmPage>
  );
}
