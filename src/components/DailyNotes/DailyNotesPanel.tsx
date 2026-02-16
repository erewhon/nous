import { useState, useEffect, useCallback } from "react";
import { useDailyNotesStore } from "../../stores/dailyNotesStore";
import { useNotebookStore } from "../../stores/notebookStore";
import { usePageStore } from "../../stores/pageStore";
import { useTemplateStore } from "../../stores/templateStore";
import { useEnergyStore } from "../../stores/energyStore";
import { useMoodHabitStore } from "../../stores/moodHabitStore";
import { DailyNotesCalendar } from "./DailyNotesCalendar";
import { DailyNotesList } from "./DailyNotesList";
import { MoodHabitChart } from "./MoodHabitChart";
import { RollupDialog } from "./RollupDialog";
import { ReflectionPrompts } from "./ReflectionPrompts";
import { DigestPanel } from "./DigestPanel";
import { EnergyCheckInDialog } from "../Energy/EnergyCheckInDialog";
import { EnergyCalendar } from "../Energy/EnergyCalendar";
import { localToday } from "../../utils/dateLocal";
import type { Page, EditorData } from "../../types/page";
import type { CreateCheckInRequest } from "../../types/energy";

interface DailyNotesPanelProps {
  isOpen?: boolean;
  onClose?: () => void;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function formatSelectedDate(dateStr: string): string {
  const [year, month, day] = dateStr.split("-");
  const monthIndex = parseInt(month, 10) - 1;
  return `${MONTH_NAMES[monthIndex]} ${parseInt(day, 10)}, ${year}`;
}

export function DailyNotesPanel({ isOpen: isOpenProp, onClose: onCloseProp }: DailyNotesPanelProps) {
  const {
    isPanelOpen,
    isLoading,
    selectedDate,
    dailyNotes,
    datesWithNotes,
    closePanel,
    selectDate,
    goToToday,
    goToPreviousDay,
    goToNextDay,
    loadDailyNotes,
    openOrCreateDailyNote,
  } = useDailyNotesStore();

  const { selectedNotebookId } = useNotebookStore();
  const { selectPage } = usePageStore();
  const {
    todayCheckIn,
    checkIns,
    loadTodayCheckIn,
    loadCheckInsRange,
    submitCheckIn: energySubmitCheckIn,
    openCheckIn: energyOpenCheckIn,
    openCalendar: energyOpenCalendar,
  } = useEnergyStore();

  const { habitList } = useMoodHabitStore();

  const [showMoodChart, setShowMoodChart] = useState(false);
  const [showRollup, setShowRollup] = useState(false);

  const isOpen = isOpenProp !== undefined ? isOpenProp : isPanelOpen;
  const handleClose = onCloseProp || closePanel;

  const today = localToday();
  const isToday = selectedDate === today;

  // Check-in for the currently selected date
  const selectedCheckIn = isToday
    ? todayCheckIn
    : (checkIns.get(selectedDate) ?? null);

  // Load daily notes when panel opens or notebook changes
  useEffect(() => {
    if (isOpen && selectedNotebookId) {
      loadDailyNotes(selectedNotebookId);
    }
  }, [isOpen, selectedNotebookId, loadDailyNotes]);

  // Load energy check-in for selected date
  useEffect(() => {
    if (isOpen) {
      if (isToday) {
        loadTodayCheckIn();
      } else {
        loadCheckInsRange(selectedDate, selectedDate);
      }
    }
  }, [isOpen, selectedDate, isToday, loadTodayCheckIn, loadCheckInsRange]);

  // Quick mood check-in handler (inline 1-tap, preserves existing fields)
  const handleQuickMood = useCallback(
    async (level: number) => {
      const request: CreateCheckInRequest = {
        date: selectedDate,
        mood: level,
        energyLevel: selectedCheckIn?.energyLevel ?? undefined,
        focusCapacity: selectedCheckIn?.focusCapacity ?? [],
        habits: selectedCheckIn?.habits ?? [],
      };
      try {
        await energySubmitCheckIn(request);
      } catch {
        // Error handled in store
      }
    },
    [energySubmitCheckIn, selectedCheckIn, selectedDate]
  );

  // Quick energy check-in handler (inline 1-tap, preserves existing fields)
  const handleQuickEnergy = useCallback(
    async (level: number) => {
      const request: CreateCheckInRequest = {
        date: selectedDate,
        energyLevel: level,
        mood: selectedCheckIn?.mood ?? undefined,
        focusCapacity: selectedCheckIn?.focusCapacity ?? [],
        habits: selectedCheckIn?.habits ?? [],
      };
      try {
        await energySubmitCheckIn(request);
      } catch {
        // Error handled in store
      }
    },
    [energySubmitCheckIn, selectedCheckIn, selectedDate]
  );

  // Quick habit toggle handler (preserves existing fields)
  const handleHabitToggle = useCallback(
    async (habitName: string) => {
      // Build current habits list, toggling the specified one
      const currentHabits = selectedCheckIn?.habits ?? habitList.map((name) => ({ name, checked: false }));
      const updatedHabits = currentHabits.map((h) =>
        h.name === habitName ? { ...h, checked: !h.checked } : h
      );
      // Add any habits from habitList that aren't in the current list
      for (const name of habitList) {
        if (!updatedHabits.find((h) => h.name === name)) {
          updatedHabits.push({ name, checked: false });
        }
      }
      const request: CreateCheckInRequest = {
        date: selectedDate,
        mood: selectedCheckIn?.mood ?? undefined,
        energyLevel: selectedCheckIn?.energyLevel ?? undefined,
        focusCapacity: selectedCheckIn?.focusCapacity ?? [],
        habits: updatedHabits,
      };
      try {
        await energySubmitCheckIn(request);
      } catch {
        // Error handled in store
      }
    },
    [energySubmitCheckIn, selectedCheckIn, selectedDate, habitList]
  );

  // Reload when month changes
  const handleMonthChange = useCallback(
    (month: string) => {
      if (selectedNotebookId) {
        loadDailyNotes(selectedNotebookId, month);
      }
      selectDate(month);
    },
    [selectedNotebookId, loadDailyNotes, selectDate]
  );

  // Open or create note for selected date
  const handleOpenNote = useCallback(async () => {
    if (!selectedNotebookId) return;

    try {
      // Check if note already exists before creating
      const existingNote = datesWithNotes.has(selectedDate);
      const note = await openOrCreateDailyNote(selectedNotebookId, selectedDate);

      // Add the note to the page store if not already present, then select it
      const { pages, panes, activePaneId, updatePageContent } = usePageStore.getState();
      const existingPage = pages.find((p) => p.id === note.id);

      if (!existingPage) {
        // Add the new page to the store and open it in the active pane
        const activePaneIdToUse = activePaneId || panes[0]?.id;
        usePageStore.setState((state) => {
          const newPages = [note, ...state.pages.filter((p) => p.id !== note.id)];
          const newPanes = state.panes.map((pane) => {
            if (pane.id !== activePaneIdToUse) return pane;
            // Add to tabs if not already there
            if (pane.tabs.find((t) => t.pageId === note.id)) {
              return { ...pane, pageId: note.id };
            }
            return {
              ...pane,
              pageId: note.id,
              tabs: [...pane.tabs, { pageId: note.id, title: note.title, isPinned: false }],
            };
          });
          return { pages: newPages, panes: newPanes, selectedPageId: note.id };
        });

        // If this is a newly created note (not existing), apply template content
        if (!existingNote && note.templateId) {
          const template = useTemplateStore.getState().templates.find(
            (t) => t.id === note.templateId
          );
          if (template && template.content.blocks.length > 0) {
            // Deep clone the content and generate new block IDs
            const contentWithNewIds: EditorData = {
              time: Date.now(),
              version: template.content.version,
              blocks: template.content.blocks.map((block) => ({
                ...block,
                id: crypto.randomUUID(),
                data: { ...block.data },
              })),
            };
            // Apply the template content
            await updatePageContent(selectedNotebookId, note.id, contentWithNewIds);
            // Update the local page with the new content
            usePageStore.setState((state) => ({
              pages: state.pages.map((p) =>
                p.id === note.id ? { ...p, content: contentWithNewIds } : p
              ),
            }));
          }
        }
      } else {
        selectPage(note.id);
      }
    } catch (err) {
      console.error("Failed to open daily note:", err);
    }
  }, [selectedNotebookId, selectedDate, openOrCreateDailyNote, selectPage, datesWithNotes]);

  // Handle clicking on a note in the list
  const handleNoteSelect = useCallback(
    (note: Page) => {
      if (note.dailyNoteDate) {
        selectDate(note.dailyNoteDate);
      }

      // Ensure the note is in the page store before selecting
      const { pages, panes, activePaneId } = usePageStore.getState();
      const existingPage = pages.find((p) => p.id === note.id);

      if (!existingPage) {
        // Add the page to the store and open it in the active pane
        const activePaneIdToUse = activePaneId || panes[0]?.id;
        usePageStore.setState((state) => {
          const newPages = [note, ...state.pages.filter((p) => p.id !== note.id)];
          const newPanes = state.panes.map((pane) => {
            if (pane.id !== activePaneIdToUse) return pane;
            if (pane.tabs.find((t) => t.pageId === note.id)) {
              return { ...pane, pageId: note.id };
            }
            return {
              ...pane,
              pageId: note.id,
              tabs: [...pane.tabs, { pageId: note.id, title: note.title, isPinned: false }],
            };
          });
          return { pages: newPages, panes: newPanes, selectedPageId: note.id };
        });
      } else {
        selectPage(note.id);
      }
    },
    [selectDate, selectPage]
  );

  const hasNoteForSelectedDate = datesWithNotes.has(selectedDate);

  if (!isOpen) return null;

  return (
    <div
      className="fixed bottom-0 right-0 top-0 z-40 flex flex-col border-l shadow-lg"
      style={{
        width: "320px",
        backgroundColor: "var(--color-bg-primary)",
        borderColor: "var(--color-border)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between border-b px-4 py-3"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div className="flex items-center gap-2">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ color: "var(--color-accent)" }}
          >
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          <span
            className="text-sm font-semibold"
            style={{ color: "var(--color-text-primary)" }}
          >
            Daily Notes
          </span>
        </div>
        <button
          onClick={handleClose}
          className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-[--color-bg-tertiary]"
          style={{ color: "var(--color-text-muted)" }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Date navigation */}
      <div
        className="flex items-center justify-between border-b px-4 py-2"
        style={{ borderColor: "var(--color-border)" }}
      >
        <button
          onClick={goToPreviousDay}
          className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-[--color-bg-tertiary]"
          style={{ color: "var(--color-text-muted)" }}
          title="Previous day"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        <div className="flex items-center gap-2">
          <span
            className="text-sm font-medium"
            style={{ color: "var(--color-text-primary)" }}
          >
            {formatSelectedDate(selectedDate)}
          </span>
          {isToday ? (
            <span
              className="rounded-md px-2 py-0.5 text-xs font-medium"
              style={{ color: "var(--color-accent)" }}
            >
              Today
            </span>
          ) : (
            <button
              onClick={goToToday}
              className="rounded-md px-2 py-0.5 text-xs transition-colors hover:bg-[--color-bg-tertiary]"
              style={{ color: "var(--color-accent)" }}
            >
              Today
            </button>
          )}
        </div>

        <button
          onClick={goToNextDay}
          className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-[--color-bg-tertiary]"
          style={{ color: "var(--color-text-muted)" }}
          title="Next day"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      {/* Daily Check-in Widget */}
      <div
        className="border-b px-4 py-2"
        style={{ borderColor: "var(--color-border)" }}
      >
        {selectedCheckIn && (selectedCheckIn.mood || selectedCheckIn.energyLevel) ? (
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 text-xs font-medium" style={{ color: "var(--color-text-secondary)" }}>
                {selectedCheckIn.mood && (
                  <span>
                    {selectedCheckIn.mood === 1 ? "\u{1F614}" : selectedCheckIn.mood === 2 ? "\u{1F615}" : selectedCheckIn.mood === 3 ? "\u{1F610}" : selectedCheckIn.mood === 4 ? "\u{1F642}" : "\u{1F60A}"}
                    {" "}Mood {selectedCheckIn.mood}/5
                  </span>
                )}
                {selectedCheckIn.energyLevel && (
                  <span>
                    {selectedCheckIn.energyLevel === 1 ? "\u{1F629}" : selectedCheckIn.energyLevel === 2 ? "\u{1F614}" : selectedCheckIn.energyLevel === 3 ? "\u{1F610}" : selectedCheckIn.energyLevel === 4 ? "\u{1F60A}" : "\u{26A1}"}
                    {" "}Energy {selectedCheckIn.energyLevel}/5
                  </span>
                )}
              </div>
              <button
                onClick={() => energyOpenCheckIn(selectedDate)}
                className="rounded px-2 py-0.5 text-[10px] transition-colors hover:bg-[--color-bg-tertiary]"
                style={{ color: "var(--color-text-muted)" }}
              >
                Edit
              </button>
            </div>
            {selectedCheckIn.habits.length > 0 && (
              <div
                className="mt-1 text-[11px]"
                style={{ color: "var(--color-text-muted)" }}
              >
                {selectedCheckIn.habits.filter((h) => h.checked).map((h) => h.name).join(", ") || "No habits checked"}
                {" "}({selectedCheckIn.habits.filter((h) => h.checked).length}/{selectedCheckIn.habits.length})
              </div>
            )}
          </div>
        ) : (
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <div
                className="text-[10px] font-medium uppercase tracking-wide"
                style={{ color: "var(--color-text-muted)" }}
              >
                Daily Check-in
              </div>
              <button
                onClick={() => energyOpenCheckIn(selectedDate)}
                className="rounded px-2 py-0.5 text-[10px] transition-colors hover:bg-[--color-bg-tertiary]"
                style={{ color: "var(--color-text-muted)" }}
              >
                More
              </button>
            </div>
            {/* Mood row */}
            <div className="mb-1 flex items-center gap-1">
              <span className="w-10 text-[10px]" style={{ color: "var(--color-text-muted)" }}>Mood</span>
              {[
                { v: 1, e: "\u{1F614}" },
                { v: 2, e: "\u{1F615}" },
                { v: 3, e: "\u{1F610}" },
                { v: 4, e: "\u{1F642}" },
                { v: 5, e: "\u{1F60A}" },
              ].map((level) => (
                <button
                  key={level.v}
                  onClick={() => handleQuickMood(level.v)}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-sm transition-colors hover:bg-[--color-bg-tertiary]"
                  title={`Mood ${level.v}/5`}
                >
                  {level.e}
                </button>
              ))}
            </div>
            {/* Energy row */}
            <div className="mb-1 flex items-center gap-1">
              <span className="w-10 text-[10px]" style={{ color: "var(--color-text-muted)" }}>Energy</span>
              {[
                { v: 1, e: "\u{1F629}" },
                { v: 2, e: "\u{1F614}" },
                { v: 3, e: "\u{1F610}" },
                { v: 4, e: "\u{1F60A}" },
                { v: 5, e: "\u{26A1}" },
              ].map((level) => (
                <button
                  key={level.v}
                  onClick={() => handleQuickEnergy(level.v)}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-sm transition-colors hover:bg-[--color-bg-tertiary]"
                  title={`Energy ${level.v}/5`}
                >
                  {level.e}
                </button>
              ))}
            </div>
            {/* Habits row */}
            {habitList.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1">
                {habitList.map((habit) => {
                  const checked = selectedCheckIn?.habits?.find((h) => h.name === habit)?.checked ?? false;
                  return (
                    <button
                      key={habit}
                      onClick={() => handleHabitToggle(habit)}
                      className="rounded border px-2 py-0.5 text-[10px] transition-colors"
                      style={{
                        borderColor: checked ? "var(--color-accent)" : "var(--color-border)",
                        backgroundColor: checked ? "var(--color-accent-muted, rgba(59, 130, 246, 0.1))" : "transparent",
                        color: checked ? "var(--color-accent)" : "var(--color-text-muted)",
                      }}
                    >
                      {checked ? "\u2713 " : "\u25A1 "}{habit}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Calendar */}
      <div className="border-b px-4 py-3" style={{ borderColor: "var(--color-border)" }}>
        <DailyNotesCalendar
          selectedDate={selectedDate}
          datesWithNotes={datesWithNotes}
          onSelectDate={selectDate}
          onMonthChange={handleMonthChange}
        />
      </div>

      {/* Open/Create button */}
      <div className="border-b px-4 py-3" style={{ borderColor: "var(--color-border)" }}>
        <button
          onClick={handleOpenNote}
          disabled={isLoading || !selectedNotebookId}
          className="flex w-full items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50"
          style={{ backgroundColor: "var(--color-accent)" }}
        >
          {isLoading ? (
            <>
              <svg
                className="h-4 w-4 animate-spin"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              Loading...
            </>
          ) : hasNoteForSelectedDate ? (
            <>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                <polyline points="14,2 14,8 20,8" />
              </svg>
              Open Note
            </>
          ) : (
            <>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
              Create Daily Note
            </>
          )}
        </button>
      </div>

      {/* Action buttons */}
      <div
        className="flex gap-2 border-b px-4 py-2"
        style={{ borderColor: "var(--color-border)" }}
      >
        <button
          onClick={() => energyOpenCalendar()}
          className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors hover:bg-[--color-bg-tertiary]"
          style={{
            borderColor: "var(--color-border)",
            color: "var(--color-text-secondary)",
          }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
          Check-ins
        </button>
        <button
          onClick={() => setShowMoodChart(true)}
          className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors hover:bg-[--color-bg-tertiary]"
          style={{
            borderColor: "var(--color-border)",
            color: "var(--color-text-secondary)",
          }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M8 14s1.5 2 4 2 4-2 4-2" />
          </svg>
          Mood & Habits
        </button>
        <button
          onClick={() => setShowRollup(true)}
          className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors hover:bg-[--color-bg-tertiary]"
          style={{
            borderColor: "var(--color-border)",
            color: "var(--color-text-secondary)",
          }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          Rollup
        </button>
      </div>

      {/* Recent notes list */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {/* Reflection Prompts */}
        {selectedNotebookId && (
          <ReflectionPrompts notebookId={selectedNotebookId} />
        )}

        {/* AI Digest */}
        {selectedNotebookId && (
          <div className="mb-3">
            <DigestPanel notebookId={selectedNotebookId} date={selectedDate} />
          </div>
        )}

        <div
          className="mb-2 px-1 text-xs font-medium uppercase tracking-wide"
          style={{ color: "var(--color-text-muted)" }}
        >
          Recent Daily Notes
        </div>
        <DailyNotesList
          notes={dailyNotes}
          selectedDate={selectedDate}
          onSelectNote={handleNoteSelect}
        />
      </div>

      {/* Dialogs */}
      <EnergyCheckInDialog />
      <EnergyCalendar />
      <MoodHabitChart
        isOpen={showMoodChart}
        onClose={() => setShowMoodChart(false)}
      />
      {selectedNotebookId && (
        <RollupDialog
          isOpen={showRollup}
          onClose={() => setShowRollup(false)}
          notebookId={selectedNotebookId}
        />
      )}

      {/* Footer with hint */}
      {!selectedNotebookId && (
        <div
          className="border-t px-4 py-2 text-center text-xs"
          style={{
            borderColor: "var(--color-border)",
            color: "var(--color-text-muted)",
          }}
        >
          Select a notebook to use daily notes
        </div>
      )}
    </div>
  );
}
