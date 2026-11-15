function copyThroughSelection(text: string): boolean {
  const scratch = document.createElement('textarea');
  scratch.value = text;
  scratch.setAttribute('readonly', '');
  scratch.style.position = 'fixed';
  scratch.style.top = '0';
  scratch.style.left = '0';
  scratch.style.opacity = '0';
  const restoreFocus =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const host = restoreFocus?.closest('dialog') ?? document.body;
  host.appendChild(scratch);
  scratch.select();
  scratch.setSelectionRange(0, text.length);
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    scratch.remove();
    restoreFocus?.focus();
  }
}

export async function copyText(text: string): Promise<boolean> {
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return copyThroughSelection(text);
    }
  }
  return copyThroughSelection(text);
}
