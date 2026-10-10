import { z } from 'zod';
import { DEFAULT_SUFFIX, negativeLists, type RecommendationStep } from '../../shared/ads-playbook';
import { protectionInput, suffixInput, scheduleInput, type ProtectionInput } from './protections';
export interface OptimizationStep extends RecommendationStep {action?:ProtectionInput;requiresClientReview:true}
const base={version:1,source:'owner-approved-alpine',requiresClientReview:true} as const;
export const optimizationSteps:readonly OptimizationStep[]=[
  {...base,id:'ip',title:'Exclude flagged IPs from your campaigns',recommendation:'recommended',why:'Flagged Click Guard visitors can waste your advertising budget.',what:'Add the newest flagged IPs to supported campaigns, rotating the oldest observed exclusions at the 500 IP cap.',action:{kind:'ip'},needs:'domainMapping'},
  {...base,id:'negative',title:'Block searches from job seekers, students and homeowners',recommendation:'recommended',why:'Choose Contractor advertising to homeowners for local services, or Software / agency advertiser only for B2B software and agency ads.',what:'Add the selected phrase-match list to the ConstructHUB contractor negatives shared set and attach it to supported campaigns.',action:{kind:'negative',name:'ConstructHUB contractor negatives',keywords:negativeLists.contractor,mode:'add'},inputs:{type:'negative-list',default:'contractor',choices:[{value:'contractor',label:'Contractor advertising to homeowners'},{value:'software',label:'Software / agency advertiser'}]}},
  {...base,id:'presence',title:'Show ads only to people physically in your service area',recommendation:'recommended',why:'People outside your service area are less likely to become customers.',what:'Switch supported campaigns to presence-only location targeting.',action:{kind:'presence'}},
  {...base,id:'suffix',title:'Track every campaign click',recommendation:'recommended',why:'Campaign tracking helps identify where paid visits come from.',what:'Set or append a final URL suffix on supported campaigns, showing each old and new value before confirmation.',action:{kind:'suffix',suffix:DEFAULT_SUFFIX,mode:'set'},inputs:{type:'suffix',default:DEFAULT_SUFFIX}},
  {...base,id:'schedule',title:'Only run ads when someone can answer the phone',recommendation:'optional',why:'Recommended for contractors with call ads so calls reach someone; optional for software advertisers.',what:'Replace campaign schedules with your chosen hours in each account’s timezone, with omitted days turned off.',needs:'input',inputs:{type:'schedule'}},
  {...base,id:'placement',title:'Block low-quality app and site placements',recommendation:'optional',why:'Excluding placements you have reviewed can reduce low-quality traffic.',what:'Add your entered placements as account-wide exclusions for supported inventory.',needs:'input',inputs:{type:'placement'}},
  {...base,id:'landing-door',title:'Paid-click landing door',recommendation:'info',why:'A landing door helps keep unwanted traffic away from your site.',what:'ConstructHUB/Alpine-hosted sites get a click-id + key door, verified-Google-only crawler access, bot blocking and exclusions, and non-US and hosting-network redirects; customer sites get the same protection by installing the Click Guard script.',links:[{label:'Click Guard',href:'/google-ads'},{label:'Setup documentation',href:'/google-ads-guide'}]},
];
export const recommendationInputs=z.object({
  negative:z.object({list:z.enum(['contractor','software']).default('contractor')}).strict().optional(),
  suffix:z.object({suffix:suffixInput,mode:z.enum(['set','append'])}).strict().optional(),
  schedule:z.object({slots:scheduleInput}).strict().optional(),
  placement:z.object({urls:z.array(z.string()).min(1).max(500)}).strict().optional(),
}).strict();
export function recommendationAction(step:OptimizationStep,inputs:z.infer<typeof recommendationInputs>):ProtectionInput {
  if(step.id==='negative') return protectionInput.parse({...step.action,keywords:negativeLists[inputs.negative?.list ?? 'contractor']});
  if(step.id==='suffix') return protectionInput.parse({...step.action,...inputs.suffix});
  if(step.id==='schedule'||step.id==='placement') return protectionInput.parse({kind:step.id,...inputs[step.id]});
  return protectionInput.parse(step.action);
}
