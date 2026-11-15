import { describe, expect, it } from 'vitest';
import { closesOnBackdropPress, type BackdropPress } from './dialogDismissal';

const ON_BACKDROP: BackdropPress = {
  dismissible: true,
  closeOnBackdropClick: true,
  pressStartedOnBackdrop: true,
  pressEndedOnBackdrop: true,
};

describe('closing a dialog from its backdrop', () => {
  it('closes when the press starts and ends on the backdrop', () => {
    expect(closesOnBackdropPress(ON_BACKDROP)).toBe(true);
  });

  it('stays open when a drag that started inside the dialog ends on the backdrop', () => {
    expect(closesOnBackdropPress({ ...ON_BACKDROP, pressStartedOnBackdrop: false })).toBe(false);
  });

  it('stays open when a press that started on the backdrop ends inside the dialog', () => {
    expect(closesOnBackdropPress({ ...ON_BACKDROP, pressEndedOnBackdrop: false })).toBe(false);
  });

  it('stays open when the dialog opts out or cannot be dismissed', () => {
    expect(closesOnBackdropPress({ ...ON_BACKDROP, closeOnBackdropClick: false })).toBe(false);
    expect(closesOnBackdropPress({ ...ON_BACKDROP, dismissible: false })).toBe(false);
  });
});
