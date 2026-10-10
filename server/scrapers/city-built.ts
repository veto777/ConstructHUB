import type { AdapterCtx, PortalAdapter } from './types';
import pprbd from './city-built/www.pprbd.org';
import houston from './city-built/www.houstonpermittingcenter.org';
import ocean from './city-built/oceancitymd.gov';
import independence from './city-built/apps.indepmo.org';
import palm from './city-built/www.palmcoast.gov';
import lyon from './city-built/comdev.lyon-county.org';
import sjc from './city-built/webapp.sjcfl.us';
import regional, { regionalHosts } from './city-built/www.milamcountypermits.com';
import johnston from './city-built/www.johnstonnc.gov';
import summit from './city-built/permitsearch.summitoh.net';
import eugene from './city-built/pdd.eugene-or.gov';
import garden from './city-built/ggcity.org';
import coconut from './city-built/www3.coconutcreek.gov';
const sites: Record<string, PortalAdapter> = {
    'www.pprbd.org': pprbd, 'www.houstonpermittingcenter.org': houston, 'oceancitymd.gov': ocean, 'apps.indepmo.org': independence, 'www.palmcoast.gov': palm, 'comdev.lyon-county.org': lyon, 'ggcity.org': garden, 'www3.coconutcreek.gov': coconut, 'pdd.eugene-or.gov': eugene, 'permitsearch.summitoh.net': summit, 'webapp.sjcfl.us': sjc, 'www.johnstonnc.gov': johnston, ...Object.fromEntries(regionalHosts.map(host => [host, regional]))
};
export const supportedHosts = Object.freeze(Object.keys(sites));
export function siteAdapter(ctx: Pick<AdapterCtx, 'searchUrl'>): PortalAdapter {
    const url = new URL(ctx.searchUrl);
    const host = url.host;
    const site = Object.hasOwn(sites, host) ? sites[host] : undefined;
    if (!site)
        throw new Error(`City-built: no site adapter for ${host}`);
    const paths: Record<string, RegExp> = {
        'www.pprbd.org': /^\/(?:Search\/Permit)?$/,
        'www.houstonpermittingcenter.org': /^\/(?:sold-permits-search)?$/,
        'oceancitymd.gov': /^\/oc\/departments\/planning-community-development\/online-permitting\/$/,
        'apps.indepmo.org': /^\/apps\/BuildingPermits$/i,
        'www.palmcoast.gov': /^\/building\/search$/,
        'comdev.lyon-county.org': /^\/CitizenPortal\/DefaultLyon.aspx$/i,
        'webapp.sjcfl.us': /^\/watswebx\/Permit\/SearchPermit.aspx$/i,
        'www.johnstonnc.gov': /^\/(?:insp\/)?content.cfm$/i,
        'permitsearch.summitoh.net': /^\/$/,
        'pdd.eugene-or.gov': /^\/buildingpermits\/permitsearch\/?$/i,
        'ggcity.org': /^\/buildingpermit\/(?:start\/index|permits\/search)\/?$/,
        'www3.coconutcreek.gov': /^\/sd\/permit\/permit_status_01.asp$/i,
    };
    const path = paths[host] ?? /^\/(?:public(?:\/permits\/list)?)?$/;
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !path.test(url.pathname)) {
        throw new Error(`City-built: unsupported portal URL shape for ${host}`);
    }
    return site;
}
export const capabilitiesFor = (ctx: Pick<AdapterCtx, 'searchUrl'>) => siteAdapter(ctx).capabilities;
const adapter: PortalAdapter = {
    platform: 'City-built', aliases: ['city-site', 'Online permitting', 'City online permit system', 'City portal', 'County portal', pprbd.platform, 'Pikes Peak Regional Building Department (regional-administered)', houston.platform, ocean.platform, independence.platform, palm.platform, lyon.platform, sjc.platform, johnston.platform, summit.platform, coconut.platform, 'City of Eugene custom (Planning and Development permit search)', 'County permits portal', 'County permit portal', 'County Fire Marshal construction permit portal', 'FireInspection360 (WilcoPermits)'], capabilities: {
        search: ['address', 'permit'], listRecent: false, detail: false
    }, search(ctx, q) {
        return siteAdapter(ctx).search(ctx, q);
    }, listRecent(ctx, since) {
        return siteAdapter(ctx).listRecent(ctx, since);
    }
};
export default adapter;
/** Static registry capabilities cannot vary by host. Specific catalog labels get
 * capability facades over the same dispatcher so alerts can use verified feeds;
 * generic custom labels keep the conservative intersection above. */
function labelFacade(platform: string, host: string): PortalAdapter {
    const target = sites[host];
    const check = (ctx: AdapterCtx) => {
        if (new URL(ctx.searchUrl).host !== host)
            throw new Error(`${platform}: expected host ${host}`);
        siteAdapter(ctx);
    };
    return {
        ...adapter, platform, aliases: [], capabilities: target.capabilities, search(ctx, q) {
            check(ctx);
            return target.search(ctx, q);
        }, listRecent(ctx, since) {
            check(ctx);
            return target.listRecent(ctx, since);
        }
    };
}
export const watsAdapter = labelFacade('WATS (county-specific)', 'webapp.sjcfl.us');
export const eugeneAdapter = labelFacade('City of Eugene custom (Planning and Development permit search)', 'pdd.eugene-or.gov');

export const lyonAdapter = labelFacade('Community Development Citizen Portal', 'comdev.lyon-county.org');
export const palmAdapter = labelFacade('Palm Coast Connect (city-specific)', 'www.palmcoast.gov');
export const oceanAdapter = labelFacade('town online permitting', 'oceancitymd.gov');
export const pprbdAdapter = { ...labelFacade('Pikes Peak Regional Building Department (PPRBD)', 'www.pprbd.org'), aliases: ['Pikes Peak Regional Building Department (regional-administered)'] };
