//! macOS contact harvester — reads AddressBook, iMessage, and Call History databases

use std::sync::{Arc, Mutex};

use super::models::*;
use super::storage::ContactsStorage;

/// Shared contacts storage type
pub type SharedContactsStorage = Arc<Mutex<ContactsStorage>>;

/// Contact harvester that reads macOS system databases
pub struct ContactHarvester {
    #[allow(dead_code)] // Used on macOS only
    contacts_storage: SharedContactsStorage,
}

impl ContactHarvester {
    pub fn new(contacts_storage: SharedContactsStorage) -> Self {
        Self { contacts_storage }
    }
}

// ===== macOS implementation =====

#[cfg(target_os = "macos")]
mod macos {
    use super::*;
    use chrono::{DateTime, TimeZone, Utc};
    use rusqlite::{Connection, OpenFlags};
    use uuid::Uuid;

    /// Apple Core Data epoch offset: 2001-01-01 vs Unix 1970-01-01
    const APPLE_EPOCH_OFFSET: i64 = 978_307_200;

    /// Convert Apple Core Data timestamp (seconds since 2001-01-01) to UTC
    fn apple_ts_to_utc(apple_ts: f64) -> DateTime<Utc> {
        let unix_ts = apple_ts as i64 + APPLE_EPOCH_OFFSET;
        Utc.timestamp_opt(unix_ts, 0).single().unwrap_or_else(|| Utc::now())
    }

    /// Convert iMessage nanosecond timestamp to UTC
    fn imessage_ts_to_utc(ns: i64) -> DateTime<Utc> {
        // iMessage timestamps are nanoseconds since 2001-01-01
        let seconds = ns / 1_000_000_000;
        apple_ts_to_utc(seconds as f64)
    }

    impl ContactHarvester {
        /// Check if harvesting is available (macOS with accessible databases)
        pub fn is_available(&self) -> bool {
            let home = match dirs::home_dir() {
                Some(h) => h,
                None => return false,
            };

            // Check if at least the AddressBook DB exists
            let ab_path = home
                .join("Library/Application Support/AddressBook/AddressBook-v22.abcddb");
            ab_path.exists()
        }

        /// Run the full harvest: contacts, messages, calls
        pub fn harvest(&self) -> Result<HarvestResult, String> {
            let home = dirs::home_dir().ok_or("Cannot determine home directory")?;

            let storage = self.contacts_storage.lock().map_err(|e| e.to_string())?;
            let mut harvest_state = storage.get_harvest_state().map_err(|e| e.to_string())?;

            let mut contacts_added = 0usize;
            let mut contacts_updated = 0usize;
            let mut activities_added = 0usize;

            // 1. Harvest contacts from AddressBook
            let ab_path = home
                .join("Library/Application Support/AddressBook/AddressBook-v22.abcddb");
            if ab_path.exists() {
                match self.harvest_address_book(&storage, &ab_path, &mut harvest_state) {
                    Ok((added, updated)) => {
                        contacts_added += added;
                        contacts_updated += updated;
                    }
                    Err(e) => log::warn!("AddressBook harvest failed: {}", e),
                }
            }

            // 2. Harvest messages from iMessage
            let msg_path = home.join("Library/Messages/chat.db");
            if msg_path.exists() {
                match self.harvest_messages(&storage, &msg_path, &mut harvest_state) {
                    Ok(added) => activities_added += added,
                    Err(e) => log::warn!("iMessage harvest failed: {}", e),
                }
            }

            // 3. Harvest call history
            let call_path = home
                .join("Library/Application Support/CallHistoryDB/CallHistory.storedata");
            if call_path.exists() {
                match self.harvest_calls(&storage, &call_path, &mut harvest_state) {
                    Ok(added) => activities_added += added,
                    Err(e) => log::warn!("Call history harvest failed: {}", e),
                }
            }

            // Save harvest state
            storage
                .save_harvest_state(&harvest_state)
                .map_err(|e| e.to_string())?;

            Ok(HarvestResult {
                contacts_added,
                contacts_updated,
                activities_added,
            })
        }

        /// Harvest contacts from macOS AddressBook
        fn harvest_address_book(
            &self,
            storage: &ContactsStorage,
            db_path: &std::path::Path,
            harvest_state: &mut HarvestState,
        ) -> Result<(usize, usize), String> {
            let conn = Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
                .map_err(|e| format!("Cannot open AddressBook: {}", e))?;

            let min_ts = harvest_state
                .last_contact_timestamp
                .map(|ts| ts as f64)
                .unwrap_or(0.0);

            let mut stmt = conn
                .prepare(
                    "SELECT Z_PK, ZFIRSTNAME, ZLASTNAME, ZMODIFICATIONDATE
                     FROM ZABCDRECORD
                     WHERE ZMODIFICATIONDATE > ?1
                     ORDER BY ZMODIFICATIONDATE ASC",
                )
                .map_err(|e| e.to_string())?;

            let mut added = 0usize;
            let mut updated = 0usize;
            let mut max_ts = min_ts;

            let rows = stmt
                .query_map([min_ts], |row| {
                    let pk: i64 = row.get(0)?;
                    let first: Option<String> = row.get(1)?;
                    let last: Option<String> = row.get(2)?;
                    let mod_date: f64 = row.get(3)?;
                    Ok((pk, first, last, mod_date))
                })
                .map_err(|e| e.to_string())?;

            for row_result in rows {
                let (pk, first, last, mod_date) = row_result.map_err(|e| e.to_string())?;

                let name = match (first, last) {
                    (Some(f), Some(l)) => format!("{} {}", f, l),
                    (Some(f), None) => f,
                    (None, Some(l)) => l,
                    (None, None) => continue,
                };

                if mod_date > max_ts {
                    max_ts = mod_date;
                }

                // Fetch phone numbers for this contact
                let phones: Vec<String> = conn
                    .prepare(
                        "SELECT ZFULLNUMBER FROM ZABCDPHONENUMBER WHERE ZOWNER = ?1",
                    )
                    .and_then(|mut s| {
                        s.query_map([pk], |row| row.get::<_, String>(0))
                            .map(|rows| rows.filter_map(|r| r.ok()).collect())
                    })
                    .unwrap_or_default();

                // Fetch emails for this contact
                let emails: Vec<String> = conn
                    .prepare(
                        "SELECT ZADDRESS FROM ZABCDEMAILADDRESS WHERE ZOWNER = ?1",
                    )
                    .and_then(|mut s| {
                        s.query_map([pk], |row| row.get::<_, String>(0))
                            .map(|rows| rows.filter_map(|r| r.ok()).collect())
                    })
                    .unwrap_or_default();

                // Try to find existing contact by phone or email
                let existing = phones
                    .iter()
                    .find_map(|p| storage.find_contact_by_phone(p).ok().flatten())
                    .or_else(|| {
                        emails
                            .iter()
                            .find_map(|e| storage.find_contact_by_email(e).ok().flatten())
                    });

                match existing {
                    Some(mut contact) => {
                        // Merge phone numbers and emails
                        for p in &phones {
                            let norm = normalize_phone(p);
                            if !contact.phone_numbers.iter().any(|cp| normalize_phone(cp) == norm) {
                                contact.phone_numbers.push(p.clone());
                            }
                        }
                        for e in &emails {
                            let lower = e.to_lowercase();
                            if !contact.emails.iter().any(|ce| ce.to_lowercase() == lower) {
                                contact.emails.push(e.clone());
                            }
                        }
                        contact.name = name;
                        contact.updated_at = chrono::Utc::now();
                        let _ = storage.upsert_contact(contact);
                        updated += 1;
                    }
                    None => {
                        let mut contact = Contact::new(name);
                        contact.phone_numbers = phones;
                        contact.emails = emails;
                        let _ = storage.upsert_contact(contact);
                        added += 1;
                    }
                }
            }

            if max_ts > min_ts {
                harvest_state.last_contact_timestamp = Some(max_ts as i64);
            }

            Ok((added, updated))
        }

        /// Harvest messages from iMessage
        fn harvest_messages(
            &self,
            storage: &ContactsStorage,
            db_path: &std::path::Path,
            harvest_state: &mut HarvestState,
        ) -> Result<usize, String> {
            let conn = Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
                .map_err(|e| format!("Cannot open chat.db: {}", e))?;

            let min_ts = harvest_state.last_message_timestamp.unwrap_or(0);

            let mut stmt = conn
                .prepare(
                    "SELECT m.date, m.is_from_me, m.text, h.id
                     FROM message m
                     JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
                     JOIN chat_handle_join chj ON cmj.chat_id = chj.chat_id
                     JOIN handle h ON chj.handle_id = h.ROWID
                     WHERE m.date > ?1
                     ORDER BY m.date ASC
                     LIMIT 10000",
                )
                .map_err(|e| e.to_string())?;

            let mut activities = Vec::new();
            let mut max_ts = min_ts;

            let rows = stmt
                .query_map([min_ts], |row| {
                    let date: i64 = row.get(0)?;
                    let is_from_me: i32 = row.get(1)?;
                    let text: Option<String> = row.get(2)?;
                    let handle_id: String = row.get(3)?;
                    Ok((date, is_from_me, text, handle_id))
                })
                .map_err(|e| e.to_string())?;

            for row_result in rows {
                let (date, is_from_me, text, handle_id) =
                    row_result.map_err(|e| e.to_string())?;

                if date > max_ts {
                    max_ts = date;
                }

                let timestamp = imessage_ts_to_utc(date);
                let direction = if is_from_me == 1 {
                    Direction::Outgoing
                } else {
                    Direction::Incoming
                };

                let preview = text.map(|t| {
                    if t.len() > 100 {
                        format!("{}...", &t[..100])
                    } else {
                        t
                    }
                });

                // Find or create contact for this handle
                let contact_id = self
                    .find_or_create_contact_for_handle(storage, &handle_id)?;

                // Update last_contacted on the contact
                if let Ok(mut contact) = storage.get_contact(contact_id) {
                    let should_update = contact
                        .last_contacted
                        .map_or(true, |lc| timestamp > lc);
                    if should_update {
                        contact.last_contacted = Some(timestamp);
                        let _ = storage.upsert_contact(contact);
                    }
                }

                activities.push(ContactActivity {
                    id: Uuid::new_v4(),
                    contact_id,
                    activity_type: ActivityType::Message,
                    direction,
                    timestamp,
                    preview,
                    duration_seconds: None,
                });
            }

            let added = storage
                .append_activities(&activities)
                .map_err(|e| e.to_string())?;

            if max_ts > min_ts {
                harvest_state.last_message_timestamp = Some(max_ts);
            }

            Ok(added)
        }

        /// Harvest call history
        fn harvest_calls(
            &self,
            storage: &ContactsStorage,
            db_path: &std::path::Path,
            harvest_state: &mut HarvestState,
        ) -> Result<usize, String> {
            let conn = Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
                .map_err(|e| format!("Cannot open CallHistory: {}", e))?;

            let min_ts = harvest_state
                .last_call_timestamp
                .map(|ts| ts as f64)
                .unwrap_or(0.0);

            let mut stmt = conn
                .prepare(
                    "SELECT ZADDRESS, ZDATE, ZDURATION, ZANSWERED, ZORIGINATED, ZFACE_TIME_DATA
                     FROM ZCALLRECORD
                     WHERE ZDATE > ?1
                     ORDER BY ZDATE ASC
                     LIMIT 10000",
                )
                .map_err(|e| e.to_string())?;

            let mut activities = Vec::new();
            let mut max_ts = min_ts;

            let rows = stmt
                .query_map([min_ts], |row| {
                    let address: Option<String> = row.get(0)?;
                    let date: f64 = row.get(1)?;
                    let duration: Option<f64> = row.get(2)?;
                    let answered: Option<i32> = row.get(3)?;
                    let originated: Option<i32> = row.get(4)?;
                    let facetime_data: Option<Vec<u8>> = row.get(5)?;
                    Ok((address, date, duration, answered, originated, facetime_data))
                })
                .map_err(|e| e.to_string())?;

            for row_result in rows {
                let (address, date, duration, answered, originated, facetime_data) =
                    row_result.map_err(|e| e.to_string())?;

                let address = match address {
                    Some(a) if !a.is_empty() => a,
                    _ => continue,
                };

                if date > max_ts {
                    max_ts = date;
                }

                let timestamp = apple_ts_to_utc(date);
                let is_answered = answered.unwrap_or(0) == 1;
                let is_originated = originated.unwrap_or(0) == 1;
                let has_facetime = facetime_data.is_some();

                let direction = if is_originated {
                    Direction::Outgoing
                } else {
                    Direction::Incoming
                };

                let activity_type = if !is_answered && !is_originated {
                    ActivityType::MissedCall
                } else if has_facetime {
                    // Heuristic: if duration > 0, it was a video call
                    if duration.unwrap_or(0.0) > 0.0 {
                        ActivityType::FaceTimeVideo
                    } else {
                        ActivityType::FaceTimeAudio
                    }
                } else {
                    ActivityType::Call
                };

                let contact_id =
                    self.find_or_create_contact_for_handle(storage, &address)?;

                // Update last_contacted
                if let Ok(mut contact) = storage.get_contact(contact_id) {
                    let should_update = contact
                        .last_contacted
                        .map_or(true, |lc| timestamp > lc);
                    if should_update {
                        contact.last_contacted = Some(timestamp);
                        let _ = storage.upsert_contact(contact);
                    }
                }

                activities.push(ContactActivity {
                    id: Uuid::new_v4(),
                    contact_id,
                    activity_type,
                    direction,
                    timestamp,
                    preview: None,
                    duration_seconds: duration.map(|d| d as u64),
                });
            }

            let added = storage
                .append_activities(&activities)
                .map_err(|e| e.to_string())?;

            if max_ts > min_ts {
                harvest_state.last_call_timestamp = Some(max_ts as i64);
            }

            Ok(added)
        }

        /// Find or create a contact for a handle (phone number or email)
        fn find_or_create_contact_for_handle(
            &self,
            storage: &ContactsStorage,
            handle: &str,
        ) -> Result<Uuid, String> {
            // Try phone lookup first
            if let Ok(Some(contact)) = storage.find_contact_by_phone(handle) {
                return Ok(contact.id);
            }

            // Try email lookup
            if handle.contains('@') {
                if let Ok(Some(contact)) = storage.find_contact_by_email(handle) {
                    return Ok(contact.id);
                }
            }

            // Create a new contact with this handle
            let mut contact = Contact::new(handle.to_string());
            if handle.contains('@') {
                contact.emails.push(handle.to_string());
            } else {
                contact.phone_numbers.push(handle.to_string());
            }

            storage
                .upsert_contact(contact.clone())
                .map_err(|e| e.to_string())?;

            Ok(contact.id)
        }
    }
}

// ===== Non-macOS stub =====

#[cfg(not(target_os = "macos"))]
impl ContactHarvester {
    /// Harvesting is not available on non-macOS platforms
    pub fn is_available(&self) -> bool {
        false
    }

    /// Returns an error on non-macOS platforms
    pub fn harvest(&self) -> Result<HarvestResult, String> {
        Err("Contact harvesting is only available on macOS".into())
    }
}
