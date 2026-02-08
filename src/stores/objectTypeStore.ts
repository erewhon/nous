import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ObjectType, ObjectTypeProperty, PropertyType } from "../types/database";
import { BUILT_IN_OBJECT_TYPES } from "../types/database";

interface ObjectTypeState {
  customTypes: ObjectType[];
  addType: (name: string, icon: string, description?: string) => ObjectType;
  updateType: (id: string, updates: Partial<Omit<ObjectType, "id" | "builtIn">>) => void;
  deleteType: (id: string) => void;
  addPropertyToType: (typeId: string, name: string, propType: PropertyType) => void;
  removePropertyFromType: (typeId: string, propIndex: number) => void;
  updatePropertyInType: (typeId: string, propIndex: number, updates: Partial<ObjectTypeProperty>) => void;
  getAllTypes: () => ObjectType[];
}

export const useObjectTypeStore = create<ObjectTypeState>()(
  persist(
    (set, get) => ({
      customTypes: [],

      addType: (name, icon, description) => {
        const newType: ObjectType = {
          id: crypto.randomUUID(),
          name,
          icon,
          description,
          properties: [{ name: "Name", type: "text" }],
        };
        set((s) => ({ customTypes: [...s.customTypes, newType] }));
        return newType;
      },

      updateType: (id, updates) => {
        set((s) => ({
          customTypes: s.customTypes.map((t) =>
            t.id === id ? { ...t, ...updates } : t
          ),
        }));
      },

      deleteType: (id) => {
        set((s) => ({
          customTypes: s.customTypes.filter((t) => t.id !== id),
        }));
      },

      addPropertyToType: (typeId, name, propType) => {
        set((s) => ({
          customTypes: s.customTypes.map((t) =>
            t.id === typeId
              ? { ...t, properties: [...t.properties, { name, type: propType }] }
              : t
          ),
        }));
      },

      removePropertyFromType: (typeId, propIndex) => {
        set((s) => ({
          customTypes: s.customTypes.map((t) =>
            t.id === typeId
              ? { ...t, properties: t.properties.filter((_, i) => i !== propIndex) }
              : t
          ),
        }));
      },

      updatePropertyInType: (typeId, propIndex, updates) => {
        set((s) => ({
          customTypes: s.customTypes.map((t) =>
            t.id === typeId
              ? {
                  ...t,
                  properties: t.properties.map((p, i) =>
                    i === propIndex ? { ...p, ...updates } : p
                  ),
                }
              : t
          ),
        }));
      },

      getAllTypes: () => {
        return [...BUILT_IN_OBJECT_TYPES, ...get().customTypes];
      },
    }),
    {
      name: "nous-object-types",
    }
  )
);
