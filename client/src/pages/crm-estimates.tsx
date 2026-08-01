import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { CrmDocumentsPage } from "./crm-documents";

export default function CrmEstimatesPage() {
  return (
    <CrmDocumentsPage
      kind="estimates"
      actions={
        <Link href="/crm/estimates/new">
          <Button className="h-11 sm:h-10" data-testid="button-new-estimate">
            <Plus className="h-4 w-4 mr-1.5" /> New estimate
          </Button>
        </Link>
      }
    />
  );
}
