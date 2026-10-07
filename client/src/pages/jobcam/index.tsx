/**
 * /crm/jobcam — the company-wide Recent feed: every job's photos and video,
 * newest first, searchable across projects / addresses / tags / people / dates.
 */
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Camera } from "lucide-react";
import { CrmPage, CrmPageHeader } from "@/components/crm-ui";
import { JobcamFeed } from "@/components/jobcam/feed";
import { bootJobcamQueue } from "@/lib/jobcam-queue";

export default function JobcamRecentPage() {
  const { data: me } = useQuery<any>({ queryKey: ["/api/crm/me"] });
  useEffect(() => { bootJobcamQueue(); document.title = "JobCam"; }, []);
  const canManage = me?.permissions?.manageJobs === true || me?.permissions?.manageCustomers === true;
  return (
    <CrmPage wide>
      <CrmPageHeader icon={Camera} title="JobCam" subtitle="Every job-site photo and video, filed to its project with the time and location it was shot." />
      <JobcamFeed title="Recent" canManage={canManage} memberId={me?.member?.id ?? null} />
    </CrmPage>
  );
}
