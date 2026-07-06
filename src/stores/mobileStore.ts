import { create } from "zustand";

// Transient UI state for the phone shell (drawer visibility). Not persisted —
// the drawer should never be open on a fresh load.
interface MobileState {
  drawerOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  toggleDrawer: () => void;
}

export const useMobileStore = create<MobileState>((set) => ({
  drawerOpen: false,
  openDrawer: () => set({ drawerOpen: true }),
  closeDrawer: () => set({ drawerOpen: false }),
  toggleDrawer: () => set((s) => ({ drawerOpen: !s.drawerOpen })),
}));
