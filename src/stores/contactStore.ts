import { create } from "zustand";
import type {
  Contact,
  ContactActivity,
  HarvestResult,
  UpdateContactRequest,
} from "../types/contact";
import {
  listContacts as apiListContacts,
  updateContact as apiUpdateContact,
  deleteContact as apiDeleteContact,
  listContactActivities as apiListContactActivities,
  harvestContacts as apiHarvestContacts,
  isHarvesterAvailable as apiIsHarvesterAvailable,
} from "../utils/api";

interface ContactState {
  contacts: Contact[];
  selectedContactId: string | null;
  activities: Map<string, ContactActivity[]>;
  harvesterAvailable: boolean;
  isLoading: boolean;
  error: string | null;
  isPanelOpen: boolean;
  searchQuery: string;
}

interface ContactActions {
  loadContacts: () => Promise<void>;
  loadActivities: (contactId: string) => Promise<void>;
  selectContact: (id: string | null) => void;
  updateContact: (id: string, updates: UpdateContactRequest) => Promise<void>;
  deleteContact: (id: string) => Promise<void>;
  runHarvest: () => Promise<HarvestResult | null>;
  checkHarvesterAvailable: () => Promise<void>;
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;
  setSearchQuery: (query: string) => void;
  clearError: () => void;
}

type ContactStore = ContactState & ContactActions;

export const useContactStore = create<ContactStore>()((set, get) => ({
  contacts: [],
  selectedContactId: null,
  activities: new Map(),
  harvesterAvailable: false,
  isLoading: false,
  error: null,
  isPanelOpen: false,
  searchQuery: "",

  loadContacts: async () => {
    set({ isLoading: true, error: null });
    try {
      const contacts = await apiListContacts();
      // Sort by lastContacted descending
      contacts.sort((a, b) => {
        const aTime = a.lastContacted ? new Date(a.lastContacted).getTime() : 0;
        const bTime = b.lastContacted ? new Date(b.lastContacted).getTime() : 0;
        return bTime - aTime;
      });
      set({ contacts, isLoading: false });
    } catch (err) {
      set({ error: String(err), isLoading: false });
    }
  },

  loadActivities: async (contactId: string) => {
    try {
      const activities = await apiListContactActivities(contactId);
      set((state) => {
        const newActivities = new Map(state.activities);
        newActivities.set(contactId, activities);
        return { activities: newActivities };
      });
    } catch (err) {
      set({ error: String(err) });
    }
  },

  selectContact: (id: string | null) => {
    set({ selectedContactId: id });
    if (id) {
      get().loadActivities(id);
    }
  },

  updateContact: async (id: string, updates: UpdateContactRequest) => {
    try {
      const updated = await apiUpdateContact(id, updates);
      set((state) => ({
        contacts: state.contacts.map((c) => (c.id === id ? updated : c)),
      }));
    } catch (err) {
      set({ error: String(err) });
    }
  },

  deleteContact: async (id: string) => {
    try {
      await apiDeleteContact(id);
      set((state) => ({
        contacts: state.contacts.filter((c) => c.id !== id),
        selectedContactId:
          state.selectedContactId === id ? null : state.selectedContactId,
      }));
    } catch (err) {
      set({ error: String(err) });
    }
  },

  runHarvest: async () => {
    set({ isLoading: true, error: null });
    try {
      const result = await apiHarvestContacts();
      await get().loadContacts();
      set({ isLoading: false });
      return result;
    } catch (err) {
      set({ error: String(err), isLoading: false });
      return null;
    }
  },

  checkHarvesterAvailable: async () => {
    try {
      const available = await apiIsHarvesterAvailable();
      set({ harvesterAvailable: available });
    } catch {
      set({ harvesterAvailable: false });
    }
  },

  openPanel: () => set({ isPanelOpen: true }),
  closePanel: () => set({ isPanelOpen: false }),
  togglePanel: () => set((state) => ({ isPanelOpen: !state.isPanelOpen })),
  setSearchQuery: (query: string) => set({ searchQuery: query }),
  clearError: () => set({ error: null }),
}));
