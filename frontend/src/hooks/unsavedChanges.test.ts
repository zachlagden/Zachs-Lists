import { describe, expect, it } from 'vitest';
import { shouldBlockNavigation } from './unsavedChanges';

const leaving = { dirty: true, signedIn: true, fromPath: '/config', toPath: '/dashboard' };

describe('unsaved changes guard', () => {
  it('stops a move to another page while there are unsaved changes', () => {
    expect(shouldBlockNavigation(leaving)).toBe(true);
  });

  it('lets a clean page be left', () => {
    expect(shouldBlockNavigation({ ...leaving, dirty: false })).toBe(false);
  });

  it('lets the query string change on the same page', () => {
    expect(shouldBlockNavigation({ ...leaving, toPath: '/config' })).toBe(false);
  });

  it('does not hold a signed-out visitor on the page', () => {
    expect(shouldBlockNavigation({ ...leaving, signedIn: false })).toBe(false);
  });
});
