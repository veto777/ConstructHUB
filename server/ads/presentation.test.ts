import { describe, expect, it } from 'vitest';
import { auditTitle, protectionDescription } from './presentation';
import { adsStatusLabel, protectionText } from '../../client/src/components/ads-manager/presentation';

describe('saved Ads display text', () => {
  it('labels account, preview and audit states without changing API values', () => {
    expect(adsStatusLabel('ENABLED')).toBe('Enabled');
    expect(adsStatusLabel('preview')).toBe('Ready for review');
    expect(adsStatusLabel('warning', true)).toBe('Needs attention');
    expect(adsStatusLabel('info', true)).toBe('Information');
    expect(adsStatusLabel('unknown', true)).toBe('Could not be checked');
    expect(adsStatusLabel('unknown')).toBe('Outcome unknown');
  });
  it('preserves saved counts and explains the removal order and risks', () => {
    expect(protectionText('Roofing: add 2 IP exclusions, rotate 0 oldest observed exclusions; 12/500 total.')).toBe('Roofing: add 2 IP exclusions, keep all existing exclusions; 12/500 total.');
    expect(protectionText('rotate 1 oldest observed exclusions')).toBe('remove 1 exclusion that ConstructHUB first saw earliest');
    expect(protectionText('rotate 12 oldest observed exclusions')).toBe('remove 12 exclusions that ConstructHUB first saw earliest');
    const warning = protectionText('Google does not expose IP creation dates. Rotation uses ConstructHUB first-observed time (resource name breaks ties on initial import). Shared IPs can include legitimate customers.');
    expect(warning).toContain('Google does not expose IP creation dates.');
    expect(warning).toContain('their Google resource names determine the order.');
    expect(warning).toContain('Shared IPs can include legitimate customers.');
    expect(protectionText('A different warning')).toBe('A different warning');
  });
});

describe('protection preview descriptions', () => {
  it('counts distinct IPs across campaigns and discloses removals', () => {
    const operations = ['one', 'two'].flatMap(campaign => ['192.0.2.1', '192.0.2.2'].map(ipAddress => ({campaignCriterionOperation: {create: {campaign, ipBlock: {ipAddress}}}})));
    expect(protectionDescription('ip', {operations})).toBe('Block 2 IPs on 2 campaigns');
    expect(protectionDescription('ip', {operations: [...operations, {campaignCriterionOperation: {remove: 'old'}}]})).toBe('Block 2 IPs on 2 campaigns; remove 1 old exclusion');
  });
  it('does not turn missing documents into zero changes or describe reversals as additions', () => {
    expect(protectionDescription('ip')).toBe('Update blocked IP addresses');
    expect(protectionDescription('ip', {operations: []})).toBe('Already configured — no changes needed');
    expect(protectionDescription('ip', {operations: []}, 'original')).toBe('Reverse protection changes: update blocked IP addresses');
  });
  it('describes other protection types without internal kind names', () => {
    expect(protectionDescription('negative')).toBe('Update negative keywords');
    expect(protectionDescription('presence', {operations: [{campaignOperation: {update: {resourceName: 'campaign'}}}]})).toBe('Target people in your locations on 1 campaign');
  });
});

it('translates saved unavailable audit titles without changing successful findings', () => {
  expect(auditTitle('terms', 'terms: unavailable')).toBe('Search terms could not be checked');
  expect(auditTitle('terms', 'Review search terms')).toBe('Review search terms');
});
