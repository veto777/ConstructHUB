/** Serializable recommendation metadata shared with the Ads manager. */
export const DEFAULT_SUFFIX='utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&dev={device}&net={network}&loc={loc_physical_ms}';
export const negativeLists={
  software:['jobs','job','careers','career','hiring','salary','salaries','employment','apprenticeship','internship','resume','course','courses','training','certification','certificate','exam','school','degree','tutorial','how to become','license lookup','license search','near me','roof repair','roof replacement','roof leak','roofing cost','siding cost','siding installation','siding repair','remodel cost','home repair','hire a contractor','find a contractor','contractor quotes','estimate cost','diy','do it yourself','home depot','lowes','angi',"angie's list",'thumbtack','homeadvisor','login','log in','sign in','password','customer service','support number','phone number','free download','free software','free app','what is','definition','meaning','wikipedia','reddit'],
  contractor:['jobs','careers','hiring','salary','employment','resume','course','training','certification','school','diy','do it yourself','tutorial','free','cheap','login','what is','definition','wikipedia','reddit'],
};
export interface RecommendationStep {
  id:string; version:number; title:string; source:'owner-approved-alpine';
  recommendation:'recommended'|'optional'|'info'; why:string; what:string;
  needs?:'domainMapping'|'input';
  inputs?:{type:'negative-list'|'suffix'|'schedule'|'placement';default?:string;choices?:{value:string;label:string}[]};
  links?:{label:string;href:string}[];
}
