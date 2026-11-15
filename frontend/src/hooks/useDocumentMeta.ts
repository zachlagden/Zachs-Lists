import { useEffect } from 'react';
import { SITE_DESCRIPTION, SITE_NAME } from '../config/site';

export function pageTitle(title: string | null): string {
  return title ? `${title} · ${SITE_NAME}` : SITE_NAME;
}

function descriptionTag(): HTMLMetaElement | null {
  return document.querySelector<HTMLMetaElement>('meta[name="description"]');
}

export function useDocumentMeta(
  title: string | null,
  description: string = SITE_DESCRIPTION,
): void {
  useEffect(() => {
    document.title = pageTitle(title);
    descriptionTag()?.setAttribute('content', description);
    return () => {
      document.title = SITE_NAME;
      descriptionTag()?.setAttribute('content', SITE_DESCRIPTION);
    };
  }, [title, description]);
}
