//! `[ai]` section of `{data_dir}/daemon-config.toml` — daemon-side AI
//! provider credentials (Forge task "Move AI provider credentials to
//! daemon config").
//!
//! The `/api/ai/*` handlers fill any `AIConfig` fields the request omits
//! from the matching provider entry here, so browser clients never need a
//! key in localStorage. Request-supplied values always win (per-call
//! overrides keep working, and the desktop invoke path is unaffected —
//! it never consults this file).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::python_bridge::AIConfig;

/// `[ai]` table. `providers` is keyed by provider type ("openai",
/// "anthropic", "ollama", "lmstudio", ...). BTreeMap keeps the TOML
/// output deterministic.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct AiSection {
    #[serde(default)]
    pub providers: BTreeMap<String, AiProviderConfig>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct AiProviderConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_model: Option<String>,
}

impl AiSection {
    /// Redact key material before echoing to API callers — same contract
    /// as `RagConfig::sanitized()`. Keys become "***"; empty/absent keys
    /// stay absent so callers can distinguish "configured" from "not".
    pub fn sanitized(&self) -> Self {
        let mut out = self.clone();
        for provider in out.providers.values_mut() {
            if provider.api_key.as_deref().is_some_and(|k| !k.is_empty()) {
                provider.api_key = Some("***".to_string());
            }
        }
        out
    }
}

/// Fill fields the request left empty from the provider entry. Request
/// values take precedence; daemon config is the fallback; built-in
/// defaults (in the Python layer) come last.
pub fn apply_provider_defaults(config: &mut AIConfig, provider: &AiProviderConfig) {
    if config.api_key.is_none() {
        config.api_key = provider.api_key.clone().filter(|s| !s.is_empty());
    }
    if config.base_url.is_none() {
        config.base_url = provider.base_url.clone().filter(|s| !s.is_empty());
    }
    if config.model.is_none() {
        config.model = provider.default_model.clone().filter(|s| !s.is_empty());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn provider(key: &str, url: &str, model: &str) -> AiProviderConfig {
        AiProviderConfig {
            api_key: Some(key.to_string()),
            base_url: Some(url.to_string()),
            default_model: Some(model.to_string()),
        }
    }

    #[test]
    fn request_values_beat_daemon_config() {
        let mut config = AIConfig {
            provider_type: "openai".into(),
            api_key: Some("request-key".into()),
            base_url: None,
            model: Some("gpt-x".into()),
            temperature: None,
            max_tokens: None,
        };
        apply_provider_defaults(
            &mut config,
            &provider("daemon-key", "http://router:4010/v1", "auto-free"),
        );
        // Request-supplied fields untouched; omitted field filled.
        assert_eq!(config.api_key.as_deref(), Some("request-key"));
        assert_eq!(config.model.as_deref(), Some("gpt-x"));
        assert_eq!(config.base_url.as_deref(), Some("http://router:4010/v1"));
    }

    #[test]
    fn daemon_config_fills_omitted_fields() {
        let mut config = AIConfig {
            provider_type: "openai".into(),
            api_key: None,
            base_url: None,
            model: None,
            temperature: None,
            max_tokens: None,
        };
        apply_provider_defaults(
            &mut config,
            &provider("daemon-key", "http://router:4010/v1", "auto-free"),
        );
        assert_eq!(config.api_key.as_deref(), Some("daemon-key"));
        assert_eq!(config.base_url.as_deref(), Some("http://router:4010/v1"));
        assert_eq!(config.model.as_deref(), Some("auto-free"));
    }

    #[test]
    fn empty_strings_in_config_do_not_fill() {
        let mut config = AIConfig {
            provider_type: "openai".into(),
            api_key: None,
            base_url: None,
            model: None,
            temperature: None,
            max_tokens: None,
        };
        apply_provider_defaults(
            &mut config,
            &AiProviderConfig {
                api_key: Some(String::new()),
                base_url: None,
                default_model: None,
            },
        );
        assert_eq!(config.api_key, None);
    }

    #[test]
    fn sanitized_redacts_keys_but_keeps_shape() {
        let mut section = AiSection::default();
        section
            .providers
            .insert("openai".into(), provider("sk-secret", "http://x", "m"));
        section.providers.insert(
            "ollama".into(),
            AiProviderConfig {
                api_key: None,
                base_url: Some("http://localhost:11434".into()),
                default_model: None,
            },
        );

        let clean = section.sanitized();
        assert_eq!(
            clean.providers["openai"].api_key.as_deref(),
            Some("***")
        );
        assert_eq!(
            clean.providers["openai"].base_url.as_deref(),
            Some("http://x")
        );
        assert_eq!(clean.providers["ollama"].api_key, None);
        // Original untouched.
        assert_eq!(
            section.providers["openai"].api_key.as_deref(),
            Some("sk-secret")
        );
    }
}
