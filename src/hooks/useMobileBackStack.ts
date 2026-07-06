import { useEffect } from "react";
import { usePageStore } from "../stores/pageStore";
import { useMobileStore } from "../stores/mobileStore";

/**
 * Phone back-stack: page navigations push history entries so the device
 * back gesture / Android back button moves back a page instead of leaving
 * the app. Only mounted by the phone layout.
 */
export function useMobileBackStack(): void {
  const selectedPageId = usePageStore((s) => s.selectedPageId);

  useEffect(() => {
    if (!selectedPageId) return;
    if (window.history.state?.nousPageId === selectedPageId) return;
    window.history.pushState({ nousPageId: selectedPageId }, "");
  }, [selectedPageId]);

  useEffect(() => {
    const onPopState = (e: PopStateEvent) => {
      // Back closes the drawer first if it's open (matches platform habit).
      const mobile = useMobileStore.getState();
      if (mobile.drawerOpen) {
        mobile.closeDrawer();
        return;
      }
      const pageId: string | undefined = e.state?.nousPageId;
      if (pageId && pageId !== usePageStore.getState().selectedPageId) {
        void usePageStore.getState().selectPage(pageId);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
}
