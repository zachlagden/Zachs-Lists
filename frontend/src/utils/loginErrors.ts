import { formatDateTime, type DateFormatOptions } from '../lib/format';

const LOGIN_ERROR_MESSAGES: Record<string, string> = {
  oauth_declined: 'GitHub sign-in was cancelled. Sign in again to continue.',
  state_mismatch:
    'This sign-in attempt expired or was started in another tab. Start again from this page.',
  no_code: 'GitHub did not finish the sign-in. Try again.',
  api_error: 'GitHub could not be reached. Try again in a few minutes.',
  token_exchange_failed: 'GitHub rejected the sign-in. Try again.',
  no_access_token: 'GitHub did not finish the sign-in. Try again.',
  invalid_profile: 'GitHub returned account details this site cannot use.',
  account_setup_retry: 'Your account could not be set up. Try signing in again.',
  account_disabled: 'Your account has been disabled, so you cannot sign in.',
  logout_failed:
    'Signing out could not reach the server, so you may still be signed in on this device. Try again when you are back online.',
};

const FALLBACK_MESSAGE = 'Sign-in failed. Try again.';

export function loginErrorMessage(
  code: string,
  until?: string | null,
  options: DateFormatOptions = {},
): string {
  if (code === 'account_banned') {
    const end = formatDateTime(until, options);
    return end
      ? `Your account is banned until ${end}. You cannot sign in until then.`
      : 'Your account has been banned, so you cannot sign in.';
  }
  return LOGIN_ERROR_MESSAGES[code] ?? FALLBACK_MESSAGE;
}
