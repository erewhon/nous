use chrono::{Datelike, Local};
use regex::Regex;
use std::collections::HashMap;

use crate::actions::models::{ActionVariable, VariableType};

/// Variable resolver for action templates
pub struct VariableResolver {
    /// Regex for finding variable placeholders
    var_regex: Regex,
}

impl VariableResolver {
    pub fn new() -> Self {
        Self {
            var_regex: Regex::new(r"\{\{(\w+)\}\}").expect("Invalid regex"),
        }
    }

    /// Build a context map with all variable values
    pub fn build_context(&self, variables: &[ActionVariable]) -> HashMap<String, String> {
        let mut context = HashMap::new();
        let now = Local::now();

        for var in variables {
            let value = match &var.variable_type {
                VariableType::UserInput => {
                    var.default_value.clone().unwrap_or_default()
                }
                VariableType::CurrentDate => {
                    now.format("%Y-%m-%d").to_string()
                }
                VariableType::CurrentDateFormatted { format } => {
                    now.format(format).to_string()
                }
                VariableType::DayOfWeek => {
                    now.format("%A").to_string() // Full day name
                }
                VariableType::WeekNumber => {
                    now.iso_week().week().to_string()
                }
                VariableType::MonthName => {
                    now.format("%B").to_string() // Full month name
                }
                VariableType::Year => {
                    now.year().to_string()
                }
                VariableType::CurrentNotebook => {
                    // This should be set externally when running the action
                    var.default_value.clone().unwrap_or_else(|| "Untitled".to_string())
                }
            };
            context.insert(var.name.clone(), value);
        }

        // Always add built-in variables
        self.add_builtin_variables(&mut context);

        context
    }

    /// Add built-in variables that are always available
    fn add_builtin_variables(&self, context: &mut HashMap<String, String>) {
        let now = Local::now();

        // Date variables
        if !context.contains_key("date") {
            context.insert("date".to_string(), now.format("%Y-%m-%d").to_string());
        }
        if !context.contains_key("dayOfWeek") {
            context.insert("dayOfWeek".to_string(), now.format("%A").to_string());
        }
        if !context.contains_key("weekNumber") {
            context.insert("weekNumber".to_string(), now.iso_week().week().to_string());
        }
        if !context.contains_key("monthName") {
            context.insert("monthName".to_string(), now.format("%B").to_string());
        }
        if !context.contains_key("year") {
            context.insert("year".to_string(), now.year().to_string());
        }

        // Additional useful variables
        if !context.contains_key("month") {
            context.insert("month".to_string(), now.format("%m").to_string());
        }
        if !context.contains_key("day") {
            context.insert("day".to_string(), now.format("%d").to_string());
        }
        if !context.contains_key("time") {
            context.insert("time".to_string(), now.format("%H:%M").to_string());
        }
        if !context.contains_key("datetime") {
            context.insert("datetime".to_string(), now.format("%Y-%m-%d %H:%M").to_string());
        }

        // Week-related variables
        if !context.contains_key("weekStart") {
            let days_from_monday = now.weekday().num_days_from_monday();
            let monday = now.date_naive() - chrono::Duration::days(days_from_monday as i64);
            context.insert("weekStart".to_string(), monday.format("%Y-%m-%d").to_string());
        }
        if !context.contains_key("weekEnd") {
            let days_from_monday = now.weekday().num_days_from_monday();
            let sunday = now.date_naive() + chrono::Duration::days((6 - days_from_monday) as i64);
            context.insert("weekEnd".to_string(), sunday.format("%Y-%m-%d").to_string());
        }

        // Yesterday/Tomorrow
        if !context.contains_key("yesterday") {
            let yesterday = now.date_naive() - chrono::Duration::days(1);
            context.insert("yesterday".to_string(), yesterday.format("%Y-%m-%d").to_string());
        }
        if !context.contains_key("tomorrow") {
            let tomorrow = now.date_naive() + chrono::Duration::days(1);
            context.insert("tomorrow".to_string(), tomorrow.format("%Y-%m-%d").to_string());
        }
    }

    /// Substitute variables in a template string
    pub fn substitute(&self, template: &str, context: &HashMap<String, String>) -> String {
        self.var_regex.replace_all(template, |caps: &regex::Captures| {
            let var_name = &caps[1];
            context.get(var_name).cloned().unwrap_or_else(|| {
                // Keep the original placeholder if variable not found
                format!("{{{{{}}}}}", var_name)
            })
        }).to_string()
    }

    /// Check if a template contains any variables
    pub fn has_variables(&self, template: &str) -> bool {
        self.var_regex.is_match(template)
    }

    /// Extract variable names from a template
    pub fn extract_variables(&self, template: &str) -> Vec<String> {
        self.var_regex
            .captures_iter(template)
            .map(|cap| cap[1].to_string())
            .collect()
    }
}

impl Default for VariableResolver {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_substitute_simple() {
        let resolver = VariableResolver::new();
        let mut context = HashMap::new();
        context.insert("name".to_string(), "Test".to_string());

        let result = resolver.substitute("Hello {{name}}!", &context);
        assert_eq!(result, "Hello Test!");
    }

    #[test]
    fn test_substitute_multiple() {
        let resolver = VariableResolver::new();
        let mut context = HashMap::new();
        context.insert("date".to_string(), "2024-01-15".to_string());
        context.insert("dayOfWeek".to_string(), "Monday".to_string());

        let result = resolver.substitute("Daily Goals - {{date}} ({{dayOfWeek}})", &context);
        assert_eq!(result, "Daily Goals - 2024-01-15 (Monday)");
    }

    #[test]
    fn test_substitute_missing_variable() {
        let resolver = VariableResolver::new();
        let context = HashMap::new();

        let result = resolver.substitute("Hello {{unknown}}!", &context);
        assert_eq!(result, "Hello {{unknown}}!");
    }

    #[test]
    fn test_builtin_variables() {
        let resolver = VariableResolver::new();
        let context = resolver.build_context(&[]);

        // Should have built-in variables
        assert!(context.contains_key("date"));
        assert!(context.contains_key("dayOfWeek"));
        assert!(context.contains_key("weekNumber"));
        assert!(context.contains_key("monthName"));
        assert!(context.contains_key("year"));
        assert!(context.contains_key("yesterday"));
        assert!(context.contains_key("tomorrow"));
    }

    #[test]
    fn test_extract_variables() {
        let resolver = VariableResolver::new();
        let vars = resolver.extract_variables("{{date}} - {{title}} ({{weekNumber}})");

        assert_eq!(vars.len(), 3);
        assert!(vars.contains(&"date".to_string()));
        assert!(vars.contains(&"title".to_string()));
        assert!(vars.contains(&"weekNumber".to_string()));
    }

    #[test]
    fn test_has_variables() {
        let resolver = VariableResolver::new();

        assert!(resolver.has_variables("Hello {{name}}!"));
        assert!(!resolver.has_variables("Hello World!"));
    }
}
