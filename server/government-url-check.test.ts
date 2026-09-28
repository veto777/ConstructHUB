import { describe, it, expect } from 'vitest';
import { classifyGovernmentPage } from './government-url-check';
const page = (title: string, body: string, httpStatus = 200, finalUrl = 'https://county.gov/assessor') => ({ html: `<html><title>${title}</title><body>${body}</body></html>`, httpStatus, finalUrl });
describe('government page verification', () => {
  it('accepts a records department with content', () => {
    expect(classifyGovernmentPage(page('County Assessor', '<main>Property records and parcel search</main>'), 'appraiser').status).toBe('live');
  });
  it('requires permit content, not just a vendor hostname', () => {
    expect(classifyGovernmentPage(page('Sign in', '<main>Email and password</main>', 200, 'https://tenant.tylerhost.net/'), 'permit').status).toBe('unverified');
    expect(classifyGovernmentPage(page('Building permits', '<main>Search building permits</main>'), 'permit').status).toBe('live');
  });
  it('rejects generic government pages whose navigation mentions permits', () => {
    expect(classifyGovernmentPage(page('Home | County', '<nav>Permits</nav><main>Community news</main>'), 'permit').status).toBe('unverified');
  });
  it('does not certify bot blocks, outages or empty JS shells', () => {
    for (const code of [401,403,429,500,503]) expect(classifyGovernmentPage(page('Permits', '', code), 'permit').status).toBe('unverified');
    expect(classifyGovernmentPage(page('Just a moment...', 'Verify you are human'), 'permit').status).toBe('unverified');
    expect(classifyGovernmentPage(page('Loading', '<div id="root"></div>'), 'permit').status).toBe('unverified');
  });
  it('detects soft 404, domain parking and generic vendor redirects', () => {
    expect(classifyGovernmentPage(page('Page not found', 'Search property records'), 'appraiser').status).toBe('dead');
    expect(classifyGovernmentPage(page('Domain is for sale', 'Buy this domain'), 'appraiser').status).toBe('dead');
    expect(classifyGovernmentPage(page('Permit software', 'Building permits software', 200, 'https://www.accela.com/'), 'permit').status).toBe('dead');
  });
  it('does not mark an exhausted timeout dead', () => {
    expect(classifyGovernmentPage({html:'', httpStatus:null, error:'TimeoutError'}, 'permit').status).toBe('unverified');
  });
});
it('rejects a vendor marketing homepage even with assessor campaign parameters', () => {
  expect(classifyGovernmentPage(page('ParcelQuest | California Property Data', 'Property records software', 200, 'https://www.parcelquest.com/?utm_campaign=assessor'), 'appraiser').status).toBe('dead');
});

it('rejects browser-breaking TLS, DNS and refused connections', () => {
  for (const error of ['ENOTFOUND','ECONNREFUSED','CERT_HAS_EXPIRED','ERR_TLS_CERT_ALTNAME_INVALID']) {
    expect(classifyGovernmentPage({html:'',httpStatus:null,error},'appraiser').status).toBe('dead');
  }
});
it('accepts an on-topic tenant self-service home page', () => {
  expect(classifyGovernmentPage(page('Home - City of Bedford', '<main>Building permits and inspections</main>',200,'https://bedfordtx.portal.opengov.com/'),'permit').status).toBe('live');
  expect(classifyGovernmentPage(page('Home - City of Bedford', '<main>Building permits and community news</main>',200,'https://bedford.gov/'),'permit').status).toBe('dead');
});
