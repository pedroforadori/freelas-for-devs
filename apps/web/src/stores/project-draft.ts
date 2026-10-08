import type { DesiredDeadline, ProjectType } from '@f4d/contracts';
import { useEffect, useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export interface DraftAttachment {
  id: string;
  fileName: string;
  size: number;
}

/** Rascunho do projeto antes de publicar: existe só no browser (ADR-0007), sem cadastro. */
export interface ProjectDraft {
  type: ProjectType | null;
  title: string;
  description: string;
  references: string[];
  desiredDeadline: DesiredDeadline | null;
  /** Enviados na etapa de revisão (exige conta); guardados para sobreviver a um refresh. */
  attachments: DraftAttachment[];
}

export const EMPTY_DRAFT: ProjectDraft = {
  type: null,
  title: '',
  description: '',
  references: [],
  desiredDeadline: null,
  attachments: [],
};

interface DraftState {
  draft: ProjectDraft;
  update: (patch: Partial<ProjectDraft>) => void;
  reset: () => void;
}

export const useProjectDraft = create<DraftState>()(
  persist(
    (set) => ({
      draft: EMPTY_DRAFT,
      update: (patch) => set((state) => ({ draft: { ...state.draft, ...patch } })),
      reset: () => set({ draft: EMPTY_DRAFT }),
    }),
    {
      name: 'f4d-project-draft',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ draft: state.draft }),
      // Hidratado no cliente, depois da montagem: o HTML do servidor não depende do localStorage.
      skipHydration: true,
    },
  ),
);

const subscribeHydration = (onChange: () => void) =>
  useProjectDraft.persist.onFinishHydration(onChange);

/** Lê o rascunho salvo e informa quando ele está disponível (evita sobrescrever com o vazio). */
export const useDraftHydrated = (): boolean => {
  useEffect(() => {
    if (!useProjectDraft.persist.hasHydrated()) void useProjectDraft.persist.rehydrate();
  }, []);
  return useSyncExternalStore(
    subscribeHydration,
    () => useProjectDraft.persist.hasHydrated(),
    () => false,
  );
};
