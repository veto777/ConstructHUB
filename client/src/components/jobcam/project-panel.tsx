import { useEffect } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { GooglePill } from "@/components/google";
import { JobcamFeed } from "./feed";
import { bootJobcamQueue } from "@/lib/jobcam-queue";

/** The JobCam tab on the project page and the strip on the client page: the latest shots + the way to the full feed. */
export function JobcamPanel({ projectId, customerId, title = "JobCam" }: { projectId?: string; customerId?: string; title?: string }) {
  const { data: me } = useQuery<any>({ queryKey: ["/api/crm/me"] });
  useEffect(() => { bootJobcamQueue(); }, []);
  const canManage = me?.permissions?.manageJobs === true || me?.permissions?.manageCustomers === true;
  const full = projectId ? `/crm/projects/${projectId}/jobcam` : "/crm/jobcam";
  return (
    <JobcamFeed projectId={projectId} customerId={customerId} compact title={title} canManage={canManage} memberId={me?.member?.id ?? null}
      description={projectId ? "Photos and video from the job site, newest first." : "Shots from this client's projects."}
      actions={<Link href={full}><GooglePill size="sm" icon={ExternalLink} label="Open feed" testId="jobcam-panel-open" /></Link>} />
  );
}
