import { create } from 'zustand';

/**
 * Estado de cliente mínimo (ADR-0007). Dados vindos da API ficam no TanStack Query,
 * nunca aqui. O rascunho de projeto pré-cadastro (persistido) chega na F2.
 */
interface UiState {
  mobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;
}

export const useUiStore = create<UiState>()((set) => ({
  mobileNavOpen: false,
  setMobileNavOpen: (open) => set({ mobileNavOpen: open }),
}));
