import type { ProtectionInput } from './protections';
/** ALPINE PLAYBOOK INSERTION POINT.
 * These are generic, opt-in controls, NOT the owner's extracted Alpine playbook.
 * Every step expands into per-client queued previews; execution always requires confirmation.
 * Add versioned typed steps here after the owner reviews the extracted playbook.
 */
export interface OptimizationStep {
  id:string; version:number; title:string; source:'generic'|'owner-approved-alpine';
  action:ProtectionInput; requiresClientReview:true;
}
export const optimizationSteps:readonly OptimizationStep[]=[
  {id:'presence',version:1,title:'Review presence-only location targeting',source:'generic',action:{kind:'presence'},requiresClientReview:true},
];
