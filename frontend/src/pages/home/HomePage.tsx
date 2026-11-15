import { useQuery } from '@tanstack/react-query';
import { defaultListsQuery } from '../../api/lists';
import { DefaultListsCard } from '../../components/lists/DefaultListsCard';
import { useDocumentMeta } from '../../hooks/useDocumentMeta';
import { useAuthStore } from '../../store';
import { Closing, HowItWorks, WhatItDoes } from './Explainers';
import { Hero } from './Hero';

export default function HomePage() {
  useDocumentMeta(null);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const defaultLists = useQuery(defaultListsQuery());
  return (
    <div className="mx-auto max-w-[1160px] px-6">
      <Hero isAuthenticated={isAuthenticated} defaultLists={defaultLists.data} />
      <WhatItDoes />
      <HowItWorks />
      <DefaultListsCard query={defaultLists} />
      <Closing />
    </div>
  );
}
