import { useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useNotebookStore } from "../stores/notebookStore";
import { usePageStore } from "../stores/pageStore";
import { useSectionStore } from "../stores/sectionStore";
import { useFolderStore } from "../stores/folderStore";
import { useGoalsStore } from "../stores/goalsStore";
import { useContactStore } from "../stores/contactStore";
import { useEnergyStore } from "../stores/energyStore";
import { useInboxStore } from "../stores/inboxStore";
import { usePluginStore } from "../stores/pluginStore";
import { useWindowLibrary } from "../contexts/WindowContext";
import { initDaemonClient } from "../utils/daemon";
import {
  daemonEventBus,
  type DatabaseEventData,
  type FolderEventData,
  type KnownEventName,
  type PageEventData,
  type SectionEventData,
  type TagEventData,
} from "../utils/daemonEvents";

// Check goals every 15 minutes
const GOALS_CHECK_INTERVAL = 15 * 60 * 1000;

export function useAppInit() {
  const { loadNotebooks, notebooks, selectedNotebookId, selectNotebook, getNotebookViewState, saveNotebookViewState } = useNotebookStore();
  const loadPages = usePageStore((s) => s.loadPages);
  const clearPages = usePageStore((s) => s.clearPages);
  const selectPage = usePageStore((s) => s.selectPage);
  const selectedPageId = usePageStore((s) => s.selectedPageId);
  const pages = usePageStore((s) => s.pages);
  const pagesLoading = usePageStore((s) => s.isLoading);
  const refreshPages = usePageStore((s) => s.refreshPages);
  const { sections, selectedSectionId, selectSection, loadSections } = useSectionStore();
  const { loadGoals, checkAutoGoals, loadSummary } = useGoalsStore();
  const { loadContacts: loadContactsFromStore } = useContactStore();
  const loadTodayCheckIn = useEnergyStore((s) => s.loadTodayCheckIn);
  const { library } = useWindowLibrary();
  const goalsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const restoredForNotebookRef = useRef<string | null>(null);

  const loadAllFavorites = usePageStore((s) => s.loadAllFavorites);

  // Sync AI config to plugin host at startup
  useEffect(() => {
    usePluginStore.getState().syncAiConfig();
  }, []);

  // Preload the daemon API key so the first HTTP request doesn't block on it,
  // then connect to the daemon event stream to get push notifications for
  // external writes (e.g. Emacs or MCP editing a page we have open).
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    (async () => {
      try {
        await initDaemonClient();
      } catch (err) {
        console.warn("[useAppInit] Daemon client init failed:", err);
      }
      unsubscribe = daemonEventBus.subscribe((evt) => {
        // Note on idempotence: every write through the local frontend also
        // produces an event we receive here. The handlers below tolerate
        // refreshing data we already have — refreshPages on a known id is
        // a no-op visually because the diff is empty. Don't add per-id
        // filtering against "is it our own write" — the cost is small and
        // the risk of dropping a real cross-window event is real.
        const warn = (msg: string) => (err: unknown) =>
          console.warn(`[useAppInit] ${msg}:`, err);

        switch (evt.event as KnownEventName) {
          // ---- Page lifecycle ----
          case "page.created":
          case "page.updated": {
            const data = evt.data as PageEventData;
            if (data.pageId) {
              refreshPages([data.pageId]).catch(warn("refreshPages"));
            }
            break;
          }
          case "page.deleted": {
            const data = evt.data as PageEventData;
            if (data.pageId) {
              usePageStore.getState().removePageLocal(data.pageId);
            }
            break;
          }
          case "page.archived":
          case "page.unarchived":
          case "page.tags.updated":
          case "page.moved": {
            const data = evt.data as PageEventData;
            if (data.pageId) {
              refreshPages([data.pageId]).catch(warn("refreshPages"));
            }
            break;
          }
          case "page.reordered": {
            // Position-only change for many pages — coarse reload of the
            // current notebook is the simplest correct response.
            const data = evt.data as PageEventData;
            const cur = useNotebookStore.getState().selectedNotebookId;
            if (data.notebookId && data.notebookId === cur) {
              usePageStore
                .getState()
                .loadPages(data.notebookId)
                .catch(warn("loadPages"));
            }
            break;
          }

          // ---- Folder lifecycle ----
          case "folder.created":
          case "folder.updated":
          case "folder.deleted":
          case "folder.archived":
          case "folder.unarchived":
          case "folder.reordered": {
            const data = evt.data as FolderEventData;
            const cur = useNotebookStore.getState().selectedNotebookId;
            if (data.notebookId && data.notebookId === cur) {
              useFolderStore
                .getState()
                .loadFolders(data.notebookId)
                .catch(warn("loadFolders"));
              // folder.deleted with movePagesTo also moves pages — refresh
              // the page list so reassigned folder_ids are visible.
              if (
                evt.event === "folder.deleted" ||
                evt.event === "folder.archived" ||
                evt.event === "folder.unarchived" ||
                evt.event === "folder.updated"
              ) {
                usePageStore
                  .getState()
                  .loadPages(data.notebookId)
                  .catch(warn("loadPages"));
              }
            }
            break;
          }

          // ---- Section lifecycle ----
          case "section.created":
          case "section.updated":
          case "section.deleted":
          case "section.reordered": {
            const data = evt.data as SectionEventData;
            const cur = useNotebookStore.getState().selectedNotebookId;
            if (data.notebookId && data.notebookId === cur) {
              useSectionStore
                .getState()
                .loadSections(data.notebookId)
                .catch(warn("loadSections"));
              // Updates that change a section's effective scope can move
              // pages between sections — refresh page list to be safe.
              if (evt.event !== "section.created") {
                usePageStore
                  .getState()
                  .loadPages(data.notebookId)
                  .catch(warn("loadPages"));
              }
            }
            break;
          }

          // ---- Inbox ----
          case "inbox.captured":
          case "inbox.deleted": {
            useInboxStore.getState().refresh().catch(warn("inbox.refresh"));
            break;
          }

          // ---- Tags ----
          case "tag.renamed":
          case "tag.merged":
          case "tag.deleted": {
            const data = evt.data as TagEventData;
            const cur = useNotebookStore.getState().selectedNotebookId;
            if (data.notebookId && data.notebookId === cur) {
              // Tag changes touch many pages; coarse reload keeps the page
              // list, page.tags arrays, and tag tree consistent.
              usePageStore
                .getState()
                .loadPages(data.notebookId)
                .catch(warn("loadPages"));
            }
            break;
          }

          // ---- Database ----
          case "database.created":
          case "database.rows_added":
          case "database.rows_updated":
          case "database.rows_deleted": {
            // Database content lives on a page; refreshing the page picks
            // up row/column changes via the standard page-content read.
            const data = evt.data as DatabaseEventData;
            if (data.pageId) {
              refreshPages([data.pageId]).catch(warn("refreshPages"));
            }
            break;
          }

          // ---- Misc ----
          case "artwork.imported":
            // page.created already fires for the imported page; no extra
            // work needed here.
            break;

          default:
            break;
        }
      });
      daemonEventBus.start();
    })();
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [refreshPages]);

  // Load notebooks and cross-notebook favorites when library is available
  useEffect(() => {
    if (library) {
      loadNotebooks();
      loadAllFavorites();
    }
  }, [loadNotebooks, loadAllFavorites, library]);

  // Validate persisted selectedNotebookId still exists after notebooks load
  useEffect(() => {
    if (notebooks.length === 0 || !selectedNotebookId) return;
    if (!notebooks.some((n) => n.id === selectedNotebookId)) {
      selectNotebook(null);
    }
  }, [notebooks, selectedNotebookId, selectNotebook]);

  // Load pages when notebook selection changes
  useEffect(() => {
    if (selectedNotebookId) {
      loadPages(selectedNotebookId);
    } else {
      clearPages();
    }
  }, [selectedNotebookId, loadPages, clearPages]);

  // Restore last-viewed section and page when switching back to a notebook
  useEffect(() => {
    if (!selectedNotebookId || pagesLoading) return;
    if (selectedNotebookId === restoredForNotebookRef.current) return;

    restoredForNotebookRef.current = selectedNotebookId;

    const savedState = getNotebookViewState(selectedNotebookId);
    if (!savedState) return;

    if (savedState.sectionId) {
      // Validate section still exists if sections are loaded
      if (sections.length === 0 || sections.some((s) => s.id === savedState.sectionId)) {
        selectSection(savedState.sectionId);
      }
    }
    if (savedState.pageId && pages.some((p) => p.id === savedState.pageId)) {
      selectPage(savedState.pageId);
    }
  }, [selectedNotebookId, pagesLoading, pages, sections, getNotebookViewState, selectPage, selectSection]);

  // Continuously persist current section/page into notebookViewState so it
  // survives an app restart (selectNotebook only saves on *switch*, not on quit)
  useEffect(() => {
    if (!selectedNotebookId) return;
    // Skip during the initial restore to avoid overwriting saved state with
    // stale defaults before the restore effect has run
    if (restoredForNotebookRef.current !== selectedNotebookId) return;

    saveNotebookViewState(selectedNotebookId, selectedSectionId, selectedPageId);
  }, [selectedNotebookId, selectedSectionId, selectedPageId, saveNotebookViewState]);

  // sync-pages-updated listener removed: when sync writes pages, the daemon
  // emits page.updated for each one, and the WS handler above (case
  // "page.updated") refreshes them. The Tauri-side `sync-pages-updated`
  // event is still emitted by sync/manager.rs but no longer subscribed
  // here; it can be retired in a follow-up.

  // Listen for sync-goals-updated events from the backend.
  // When sync pulls goal or progress changes from remote, refresh displays.
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;

    const setup = async () => {
      unlisten = await listen("sync-goals-updated", () => {
        console.log("[sync] Goals updated by sync, refreshing");
        loadGoals();
        loadSummary();
        checkAutoGoals();
      });
    };

    setup();

    return () => {
      if (unlisten) unlisten();
    };
  }, [loadGoals, loadSummary, checkAutoGoals]);

  // Listen for sync-contacts-updated events from the backend.
  // When sync pulls contact or activity changes from remote, refresh displays.
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;

    const setup = async () => {
      unlisten = await listen("sync-contacts-updated", () => {
        console.log("[sync] Contacts updated by sync, refreshing");
        loadContactsFromStore();
      });
    };

    setup();

    return () => {
      if (unlisten) unlisten();
    };
  }, [loadContactsFromStore]);

  // Listen for sync-energy-updated events from the backend.
  // When sync pulls energy check-in changes from remote, refresh displays.
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;

    const setup = async () => {
      unlisten = await listen("sync-energy-updated", () => {
        console.log("[sync] Energy updated by sync, refreshing");
        loadTodayCheckIn();
      });
    };

    setup();

    return () => {
      if (unlisten) unlisten();
    };
  }, [loadTodayCheckIn]);

  // Listen for mcp-inbox-updated events from the file watcher.
  // When the MCP server writes inbox items to disk, refresh the inbox store.
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;

    const setup = async () => {
      unlisten = await listen("mcp-inbox-updated", () => {
        console.log("[mcp-watcher] Inbox updated externally, refreshing");
        useInboxStore.getState().loadItems();
      });
    };

    setup();

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // Listen for sync-notebook-updated events from the backend.
  // When sync pulls notebook metadata or section changes, reload them.
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;

    const setup = async () => {
      unlisten = await listen<{ notebookId: string }>(
        "sync-notebook-updated",
        (event) => {
          const { notebookId } = event.payload;
          console.log(`[sync] Notebook ${notebookId} updated by sync, refreshing`);
          loadNotebooks();
          loadSections(notebookId);
        }
      );
    };

    setup();

    return () => {
      if (unlisten) unlisten();
    };
  }, [loadNotebooks, loadSections]);

  // Load goals and check auto-detected goals on app init and periodically
  useEffect(() => {
    // Initial load
    loadGoals();
    loadSummary();
    checkAutoGoals();

    // Set up periodic checking
    goalsIntervalRef.current = setInterval(() => {
      checkAutoGoals();
      loadSummary();
    }, GOALS_CHECK_INTERVAL);

    // Also check on window focus
    const handleFocus = () => {
      checkAutoGoals();
      loadSummary();
    };
    window.addEventListener("focus", handleFocus);

    return () => {
      if (goalsIntervalRef.current) {
        clearInterval(goalsIntervalRef.current);
      }
      window.removeEventListener("focus", handleFocus);
    };
  }, [loadGoals, loadSummary, checkAutoGoals]);
}
