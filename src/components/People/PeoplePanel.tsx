import { useEffect } from "react";
import { useContactStore } from "../../stores/contactStore";
import { ContactList } from "./ContactList";
import { ContactDetail } from "./ContactDetail";

export function PeoplePanel() {
  const {
    contacts,
    selectedContactId,
    activities,
    harvesterAvailable,
    isLoading,
    error,
    isPanelOpen,
    searchQuery,
    closePanel,
    loadContacts,
    selectContact,
    deleteContact,
    runHarvest,
    checkHarvesterAvailable,
    setSearchQuery,
  } = useContactStore();

  // Load data when panel opens
  useEffect(() => {
    if (isPanelOpen) {
      loadContacts();
      checkHarvesterAvailable();
    }
  }, [isPanelOpen, loadContacts, checkHarvesterAvailable]);

  // Escape to close
  useEffect(() => {
    if (!isPanelOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (selectedContactId) {
          selectContact(null);
        } else {
          closePanel();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPanelOpen, selectedContactId, selectContact, closePanel]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      closePanel();
    }
  };

  if (!isPanelOpen) return null;

  const selectedContact = contacts.find((c) => c.id === selectedContactId);
  const selectedActivities = selectedContactId
    ? activities.get(selectedContactId) || []
    : [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleBackdropClick}
    >
      <div
        className="flex h-[80vh] w-full max-w-2xl flex-col rounded-xl border shadow-2xl"
        style={{
          backgroundColor: "var(--color-bg-secondary)",
          borderColor: "var(--color-border)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between border-b px-4 py-3 shrink-0"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div className="flex items-center gap-3">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ color: "var(--color-accent)" }}
            >
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            <div>
              <h2
                className="font-semibold"
                style={{ color: "var(--color-text-primary)" }}
              >
                People
              </h2>
              <p
                className="text-xs"
                style={{ color: "var(--color-text-muted)" }}
              >
                {contacts.length} contact{contacts.length !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {harvesterAvailable && (
              <button
                onClick={() => runHarvest()}
                disabled={isLoading}
                className="rounded-md px-2.5 py-1 text-xs font-medium transition-colors hover:bg-white/10"
                style={{ color: "var(--color-text-secondary)" }}
                title="Harvest contacts, messages, and calls from macOS"
              >
                {isLoading ? "Harvesting..." : "Harvest Now"}
              </button>
            )}
            <button
              onClick={closePanel}
              className="rounded p-1.5 transition-colors hover:bg-white/10"
              style={{ color: "var(--color-text-muted)" }}
            >
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
              >
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div
            className="mx-4 mt-2 rounded-lg px-3 py-2 text-sm"
            style={{
              backgroundColor: "rgba(239, 68, 68, 0.1)",
              color: "var(--color-error)",
            }}
          >
            {error}
          </div>
        )}

        {/* Content: two-pane layout */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left: contact list */}
          <div
            className="w-64 shrink-0 border-r overflow-hidden"
            style={{ borderColor: "var(--color-border)" }}
          >
            {isLoading && contacts.length === 0 ? (
              <div
                className="flex items-center justify-center py-12"
                style={{ color: "var(--color-text-muted)" }}
              >
                Loading...
              </div>
            ) : (
              <ContactList
                contacts={contacts}
                selectedContactId={selectedContactId}
                searchQuery={searchQuery}
                onSelect={selectContact}
                onSearchChange={setSearchQuery}
              />
            )}
          </div>

          {/* Right: detail / activity */}
          <div className="flex-1 overflow-hidden">
            {selectedContact ? (
              <ContactDetail
                contact={selectedContact}
                activities={selectedActivities}
                onDelete={() => {
                  if (
                    confirm(
                      `Delete "${selectedContact.name}"? This will also remove their activity history.`
                    )
                  ) {
                    deleteContact(selectedContact.id);
                  }
                }}
              />
            ) : (
              <div
                className="flex h-full flex-col items-center justify-center px-4 text-center"
                style={{ color: "var(--color-text-muted)" }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="48"
                  height="48"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="mb-4 opacity-50"
                >
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
                <p className="text-sm font-medium">Select a contact</p>
                <p className="text-xs mt-1">
                  Choose someone from the list to view their activity
                </p>
                {!harvesterAvailable && contacts.length === 0 && (
                  <p className="text-xs mt-3 opacity-75">
                    Contact harvesting requires macOS. Contacts synced from
                    another device will appear here.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
