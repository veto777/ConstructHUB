import { describe, expect, it } from 'vitest';
import { reviewDiff } from './review-changes';

const b = (id: number, over: Partial<any> = {}) => ({ id, google_review_id: `accounts/a/locations/l/reviews/${id}`, reviewer_name: `R${id}`, rating: 5, comment: `text ${id}`, review_date: '2026-01-01', reply_comment: null, google_deleted: false, ...over });
const a = (id: number, over: Partial<any> = {}) => ({ name: `accounts/a/locations/l/reviews/${id}`, reviewer: `R${id}`, rating: 5, comment: `text ${id}`, date: '2026-01-01', reply: null, ...over });

describe('review changes', () => {
  it('names the review that vanished, the one that changed, the one that came back and the new one', () => {
    const events = reviewDiff([b(1), b(2), b(3), b(4, { google_deleted: true })], [a(1), a(2, { rating: 1, comment: 'changed my mind' }), a(4), a(5)]);
    expect(events.map((e) => [e.kind, e.googleReviewId.split('/').pop()])).toEqual([['edited', '2'], ['removed', '3'], ['restored', '4'], ['added', '5']]);
    const edited = events[0];
    expect(edited.before?.rating).toBe(5); expect(edited.after?.rating).toBe(1);
    expect(events[1].before?.comment).toBe('text 3'); // the full text survives for the appeal
  });
  it('a reply or whitespace is not an edit, and the first sync is history, not news', () => {
    expect(reviewDiff([b(1, { comment: ' text 1 ' })], [a(1, { reply: 'thanks!' })])).toEqual([]);
    expect(reviewDiff([], [a(1), a(2)])).toEqual([]);
    expect(reviewDiff([b(1, { google_deleted: true })], [])).toEqual([]); // already gone: nothing new to say
  });
});
