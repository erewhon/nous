//! Energy check-in storage implementation

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use chrono::{Datelike, Duration, Local, NaiveDate, Utc};
use uuid::Uuid;

use super::models::*;
use crate::storage::StorageError;

type Result<T> = std::result::Result<T, StorageError>;

/// Storage for energy check-ins
pub struct EnergyStorage {
    energy_dir: PathBuf,
}

impl EnergyStorage {
    /// Create a new energy storage
    pub fn new(data_dir: PathBuf) -> Result<Self> {
        let energy_dir = data_dir.join("energy");
        fs::create_dir_all(&energy_dir)?;

        Ok(Self { energy_dir })
    }

    /// Get the path to the check-ins file
    fn checkins_file(&self) -> PathBuf {
        self.energy_dir.join("checkins.json")
    }

    // ===== CRUD Operations =====

    /// List all check-ins
    pub fn list_checkins(&self) -> Result<Vec<EnergyCheckIn>> {
        let path = self.checkins_file();
        if !path.exists() {
            return Ok(Vec::new());
        }

        let content = fs::read_to_string(path)?;
        let checkins: Vec<EnergyCheckIn> = serde_json::from_str(&content)?;
        Ok(checkins)
    }

    /// Get a check-in by date
    pub fn get_checkin(&self, date: NaiveDate) -> Result<Option<EnergyCheckIn>> {
        let checkins = self.list_checkins()?;
        Ok(checkins.into_iter().find(|c| c.date == date))
    }

    /// Get check-ins within a date range
    pub fn get_checkins_range(
        &self,
        start: NaiveDate,
        end: NaiveDate,
    ) -> Result<Vec<EnergyCheckIn>> {
        let checkins = self.list_checkins()?;
        Ok(checkins
            .into_iter()
            .filter(|c| c.date >= start && c.date <= end)
            .collect())
    }

    /// Upsert a check-in (create or update by date)
    pub fn upsert_checkin(&self, request: CreateCheckInRequest) -> Result<EnergyCheckIn> {
        let date = NaiveDate::parse_from_str(&request.date, "%Y-%m-%d")
            .map_err(|e| StorageError::NotFound(format!("Invalid date: {}", e)))?;

        // Validate energy level
        if request.energy_level < 1 || request.energy_level > 5 {
            return Err(StorageError::NotFound(
                "Energy level must be between 1 and 5".to_string(),
            ));
        }

        // Validate sleep quality if provided
        if let Some(sq) = request.sleep_quality {
            if sq < 1 || sq > 4 {
                return Err(StorageError::NotFound(
                    "Sleep quality must be between 1 and 4".to_string(),
                ));
            }
        }

        let mut checkins = self.list_checkins()?;
        let now = Utc::now();

        // Check if a check-in exists for this date
        if let Some(existing) = checkins.iter_mut().find(|c| c.date == date) {
            existing.energy_level = request.energy_level;
            existing.focus_capacity = request.focus_capacity;
            existing.sleep_quality = request.sleep_quality;
            existing.notes = request.notes;
            existing.updated_at = now;
            let updated = existing.clone();
            self.save_checkins(&checkins)?;
            Ok(updated)
        } else {
            let checkin = EnergyCheckIn {
                id: Uuid::new_v4(),
                date,
                energy_level: request.energy_level,
                focus_capacity: request.focus_capacity,
                sleep_quality: request.sleep_quality,
                notes: request.notes,
                created_at: now,
                updated_at: now,
            };
            checkins.push(checkin.clone());
            checkins.sort_by(|a, b| a.date.cmp(&b.date));
            self.save_checkins(&checkins)?;
            Ok(checkin)
        }
    }

    /// Update an existing check-in by date
    pub fn update_checkin(
        &self,
        date: NaiveDate,
        updates: UpdateCheckInRequest,
    ) -> Result<EnergyCheckIn> {
        let mut checkins = self.list_checkins()?;
        let checkin = checkins
            .iter_mut()
            .find(|c| c.date == date)
            .ok_or_else(|| {
                StorageError::NotFound(format!("Check-in for {} not found", date))
            })?;

        if let Some(energy_level) = updates.energy_level {
            if energy_level < 1 || energy_level > 5 {
                return Err(StorageError::NotFound(
                    "Energy level must be between 1 and 5".to_string(),
                ));
            }
            checkin.energy_level = energy_level;
        }
        if let Some(focus_capacity) = updates.focus_capacity {
            checkin.focus_capacity = focus_capacity;
        }
        if updates.sleep_quality.is_some() {
            if let Some(sq) = updates.sleep_quality {
                if sq < 1 || sq > 4 {
                    return Err(StorageError::NotFound(
                        "Sleep quality must be between 1 and 4".to_string(),
                    ));
                }
            }
            checkin.sleep_quality = updates.sleep_quality;
        }
        if updates.notes.is_some() {
            checkin.notes = updates.notes;
        }

        checkin.updated_at = Utc::now();
        let updated = checkin.clone();
        self.save_checkins(&checkins)?;
        Ok(updated)
    }

    /// Delete a check-in by date
    pub fn delete_checkin(&self, date: NaiveDate) -> Result<()> {
        let mut checkins = self.list_checkins()?;
        let len_before = checkins.len();
        checkins.retain(|c| c.date != date);

        if checkins.len() == len_before {
            return Err(StorageError::NotFound(format!(
                "Check-in for {} not found",
                date
            )));
        }

        self.save_checkins(&checkins)?;
        Ok(())
    }

    /// Replace all check-ins (used by sync merge)
    pub fn replace_checkins(&self, checkins: &[EnergyCheckIn]) -> Result<()> {
        self.save_checkins(checkins)
    }

    /// Save all check-ins to file
    fn save_checkins(&self, checkins: &[EnergyCheckIn]) -> Result<()> {
        let json = serde_json::to_string_pretty(checkins)?;
        fs::write(self.checkins_file(), json)?;
        Ok(())
    }

    // ===== Analytics =====

    /// Calculate energy patterns for a date range
    pub fn calculate_patterns(
        &self,
        start: NaiveDate,
        end: NaiveDate,
    ) -> Result<EnergyPattern> {
        let checkins = self.get_checkins_range(start, end)?;

        // Group by day of week
        let mut day_totals: HashMap<String, (f32, u32)> = HashMap::new();
        for checkin in &checkins {
            let day_name = match checkin.date.weekday() {
                chrono::Weekday::Mon => "monday",
                chrono::Weekday::Tue => "tuesday",
                chrono::Weekday::Wed => "wednesday",
                chrono::Weekday::Thu => "thursday",
                chrono::Weekday::Fri => "friday",
                chrono::Weekday::Sat => "saturday",
                chrono::Weekday::Sun => "sunday",
            };
            let entry = day_totals
                .entry(day_name.to_string())
                .or_insert((0.0, 0));
            entry.0 += checkin.energy_level as f32;
            entry.1 += 1;
        }

        let day_of_week_averages: HashMap<String, f32> = day_totals
            .iter()
            .map(|(day, (total, count))| (day.clone(), total / *count as f32))
            .collect();

        let typical_low_days: Vec<String> = day_of_week_averages
            .iter()
            .filter(|(_, avg)| **avg < 2.5)
            .map(|(day, _)| day.clone())
            .collect();

        let typical_high_days: Vec<String> = day_of_week_averages
            .iter()
            .filter(|(_, avg)| **avg >= 4.0)
            .map(|(day, _)| day.clone())
            .collect();

        // Calculate current streak
        let current_streak = self.calculate_streak()?;

        Ok(EnergyPattern {
            day_of_week_averages,
            current_streak,
            typical_low_days,
            typical_high_days,
        })
    }

    /// Calculate consecutive days with check-ins ending at today
    fn calculate_streak(&self) -> Result<u32> {
        let checkins = self.list_checkins()?;
        if checkins.is_empty() {
            return Ok(0);
        }

        let today = Local::now().date_naive();
        let checkin_dates: Vec<NaiveDate> = checkins.iter().map(|c| c.date).collect();

        let mut streak = 0u32;
        let mut check_date = today;

        // Check if today has a check-in
        if checkin_dates.contains(&check_date) {
            streak = 1;
            check_date = check_date - Duration::days(1);
        } else {
            // Today might not be over; check yesterday
            check_date = check_date - Duration::days(1);
            if !checkin_dates.contains(&check_date) {
                return Ok(0);
            }
            streak = 1;
            check_date = check_date - Duration::days(1);
        }

        // Count consecutive days backwards
        while checkin_dates.contains(&check_date) {
            streak += 1;
            check_date = check_date - Duration::days(1);
        }

        Ok(streak)
    }
}
