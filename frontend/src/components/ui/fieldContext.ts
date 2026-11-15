import { createContext } from 'react';

export interface FieldWiring {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
}

export const FieldContext = createContext<FieldWiring | null>(null);
