export interface BackdropPress {
  dismissible: boolean;
  closeOnBackdropClick: boolean;
  pressStartedOnBackdrop: boolean;
  pressEndedOnBackdrop: boolean;
}

export function closesOnBackdropPress(press: BackdropPress): boolean {
  return (
    press.dismissible &&
    press.closeOnBackdropClick &&
    press.pressStartedOnBackdrop &&
    press.pressEndedOnBackdrop
  );
}
