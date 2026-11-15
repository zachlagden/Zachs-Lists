export interface NavigationAttempt {
  dirty: boolean;
  signedIn: boolean;
  fromPath: string;
  toPath: string;
}

export function shouldBlockNavigation({
  dirty,
  signedIn,
  fromPath,
  toPath,
}: NavigationAttempt): boolean {
  return dirty && signedIn && fromPath !== toPath;
}
