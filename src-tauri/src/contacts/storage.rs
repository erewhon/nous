//! Contacts storage implementation

use std::fs;
use std::path::PathBuf;

use uuid::Uuid;

use super::models::*;
use crate::storage::StorageError;

type Result<T> = std::result::Result<T, StorageError>;

/// Storage for contacts and activities
pub struct ContactsStorage {
    contacts_dir: PathBuf,
}

impl ContactsStorage {
    /// Create a new contacts storage
    pub fn new(data_dir: PathBuf) -> Result<Self> {
        let contacts_dir = data_dir.join("contacts");
        fs::create_dir_all(&contacts_dir)?;

        Ok(Self { contacts_dir })
    }

    // ===== File paths =====

    fn contacts_file(&self) -> PathBuf {
        self.contacts_dir.join("contacts.json")
    }

    fn activity_file(&self) -> PathBuf {
        self.contacts_dir.join("activity.json")
    }

    fn harvest_state_file(&self) -> PathBuf {
        self.contacts_dir.join("harvest_state.json")
    }

    // ===== Contact CRUD =====

    /// List all contacts
    pub fn list_contacts(&self) -> Result<Vec<Contact>> {
        let path = self.contacts_file();
        if !path.exists() {
            return Ok(Vec::new());
        }
        let content = fs::read_to_string(path)?;
        let contacts: Vec<Contact> = serde_json::from_str(&content)?;
        Ok(contacts)
    }

    /// Get a contact by ID
    pub fn get_contact(&self, id: Uuid) -> Result<Contact> {
        let contacts = self.list_contacts()?;
        contacts
            .into_iter()
            .find(|c| c.id == id)
            .ok_or_else(|| StorageError::NotFound(format!("Contact {} not found", id)))
    }

    /// Upsert a contact (insert or replace by ID)
    pub fn upsert_contact(&self, contact: Contact) -> Result<Contact> {
        let mut contacts = self.list_contacts()?;
        if let Some(existing) = contacts.iter_mut().find(|c| c.id == contact.id) {
            *existing = contact.clone();
        } else {
            contacts.push(contact.clone());
        }
        self.save_contacts(&contacts)?;
        Ok(contact)
    }

    /// Find a contact by normalized phone number
    pub fn find_contact_by_phone(&self, phone: &str) -> Result<Option<Contact>> {
        let normalized = normalize_phone(phone);
        let contacts = self.list_contacts()?;
        Ok(contacts.into_iter().find(|c| {
            c.phone_numbers
                .iter()
                .any(|p| normalize_phone(p) == normalized)
        }))
    }

    /// Find a contact by email (case-insensitive)
    pub fn find_contact_by_email(&self, email: &str) -> Result<Option<Contact>> {
        let lower = email.to_lowercase();
        let contacts = self.list_contacts()?;
        Ok(contacts
            .into_iter()
            .find(|c| c.emails.iter().any(|e| e.to_lowercase() == lower)))
    }

    /// Update an existing contact
    pub fn update_contact(&self, id: Uuid, updates: UpdateContactRequest) -> Result<Contact> {
        let mut contacts = self.list_contacts()?;
        let contact = contacts
            .iter_mut()
            .find(|c| c.id == id)
            .ok_or_else(|| StorageError::NotFound(format!("Contact {} not found", id)))?;

        if let Some(name) = updates.name {
            contact.name = name;
        }
        if let Some(phone_numbers) = updates.phone_numbers {
            contact.phone_numbers = phone_numbers;
        }
        if let Some(emails) = updates.emails {
            contact.emails = emails;
        }
        if let Some(tags) = updates.tags {
            contact.tags = tags;
        }
        if let Some(notes) = updates.notes {
            contact.notes = notes;
        }
        contact.updated_at = chrono::Utc::now();

        let updated = contact.clone();
        self.save_contacts(&contacts)?;
        Ok(updated)
    }

    /// Delete a contact
    pub fn delete_contact(&self, id: Uuid) -> Result<()> {
        let mut contacts = self.list_contacts()?;
        let len_before = contacts.len();
        contacts.retain(|c| c.id != id);

        if contacts.len() == len_before {
            return Err(StorageError::NotFound(format!("Contact {} not found", id)));
        }

        self.save_contacts(&contacts)?;

        // Also remove activities for this contact
        let mut activities = self.list_activities()?;
        activities.retain(|a| a.contact_id != id);
        self.save_activities(&activities)?;

        Ok(())
    }

    fn save_contacts(&self, contacts: &[Contact]) -> Result<()> {
        let json = serde_json::to_string_pretty(contacts)?;
        fs::write(self.contacts_file(), json)?;
        Ok(())
    }

    /// Replace the full contacts list (used by sync merge)
    pub fn replace_contacts(&self, contacts: &[Contact]) -> Result<()> {
        self.save_contacts(contacts)
    }

    // ===== Activity operations =====

    /// List all activities
    pub fn list_activities(&self) -> Result<Vec<ContactActivity>> {
        let path = self.activity_file();
        if !path.exists() {
            return Ok(Vec::new());
        }
        let content = fs::read_to_string(path)?;
        let activities: Vec<ContactActivity> = serde_json::from_str(&content)?;
        Ok(activities)
    }

    /// List activities for a specific contact
    pub fn list_activities_for_contact(&self, contact_id: Uuid) -> Result<Vec<ContactActivity>> {
        let activities = self.list_activities()?;
        Ok(activities
            .into_iter()
            .filter(|a| a.contact_id == contact_id)
            .collect())
    }

    /// Append activities, deduplicating by (contact_id, activity_type, timestamp)
    pub fn append_activities(&self, new_activities: &[ContactActivity]) -> Result<usize> {
        let mut activities = self.list_activities()?;
        let mut added = 0;

        for new_act in new_activities {
            let is_dup = activities.iter().any(|a| {
                a.contact_id == new_act.contact_id
                    && a.activity_type == new_act.activity_type
                    && a.timestamp == new_act.timestamp
            });
            if !is_dup {
                activities.push(new_act.clone());
                added += 1;
            }
        }

        if added > 0 {
            // Sort by timestamp descending (most recent first)
            activities.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
            self.save_activities(&activities)?;
        }

        Ok(added)
    }

    /// Replace all activities (used by sync merge)
    pub fn replace_activities(&self, activities: &[ContactActivity]) -> Result<()> {
        self.save_activities(activities)
    }

    fn save_activities(&self, activities: &[ContactActivity]) -> Result<()> {
        let json = serde_json::to_string_pretty(activities)?;
        fs::write(self.activity_file(), json)?;
        Ok(())
    }

    // ===== Harvest state =====

    /// Get the harvest state
    pub fn get_harvest_state(&self) -> Result<HarvestState> {
        let path = self.harvest_state_file();
        if !path.exists() {
            return Ok(HarvestState::default());
        }
        let content = fs::read_to_string(path)?;
        let state: HarvestState = serde_json::from_str(&content)?;
        Ok(state)
    }

    /// Save the harvest state
    pub fn save_harvest_state(&self, state: &HarvestState) -> Result<()> {
        let json = serde_json::to_string_pretty(state)?;
        fs::write(self.harvest_state_file(), json)?;
        Ok(())
    }
}
