import type {AdapterCtx, PortalAdapter} from './types';
import sjc from './city-built/webapp.sjcfl.us';
const sites:Record<string,PortalAdapter>={'webapp.sjcfl.us':sjc};
export const supportedHosts=Object.freeze(Object.keys(sites));
export function siteAdapter(ctx:Pick<AdapterCtx,'searchUrl'>):PortalAdapter {const host=new URL(ctx.searchUrl).host;const site=sites[host];if(!site)throw new Error(`City-built: no site adapter for ${host}`);return site;}
export const capabilitiesFor=(ctx:Pick<AdapterCtx,'searchUrl'>)=>siteAdapter(ctx).capabilities;
const adapter:PortalAdapter={platform:'City-built',aliases:['city-site','Online permitting','City online permit system','City portal','County portal',sjc.platform],capabilities:{search:['address','permit'],listRecent:true,detail:false},search(ctx,q){return siteAdapter(ctx).search(ctx,q);},listRecent(ctx,since){return siteAdapter(ctx).listRecent(ctx,since);}};
export default adapter;
