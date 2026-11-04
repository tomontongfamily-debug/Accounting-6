import { isDeepStrictEqual } from 'node:util';

// Review order is presentation, not an accounting change. Match as a multiset
// so repeated imports retain every warning without generating false edits.
export function sameReviewIssues(previous, next) {
  if (previous.length !== next.length) return false;
  const unmatched = [...next];
  for (const issue of previous) {
    const index = unmatched.findIndex(candidate => isDeepStrictEqual(issue, candidate));
    if (index < 0) return false;
    unmatched.splice(index, 1);
  }
  return true;
}

export function retainReviewOrder(previous = [], next = []) {
  return sameReviewIssues(previous, next) ? previous : next;
}
