//! Secure storage for API keys using OS keyring (Windows Credential Manager / macOS Keychain / Linux Secret Service)
//! Replaces plain-text storage in SQLite for enterprise compliance.

use keyring::Entry;

const SERVICE_NAME: &str = "com.maity.ai";

/// Store an API key securely in the OS keyring
pub fn store_api_key(provider: &str, key: &str) -> Result<(), String> {
    if provider.is_empty() {
        return Err("Provider name cannot be empty".to_string());
    }
    if key.is_empty() {
        return Err("API key cannot be empty".to_string());
    }

    let entry = Entry::new(SERVICE_NAME, provider)
        .map_err(|e| format!("Keyring error: {}", e))?;
    entry
        .set_password(key)
        .map_err(|e| format!("Failed to store key for {}: {}", provider, e))
}

/// Retrieve an API key from the OS keyring
pub fn get_api_key(provider: &str) -> Result<Option<String>, String> {
    if provider.is_empty() {
        return Err("Provider name cannot be empty".to_string());
    }

    let entry = Entry::new(SERVICE_NAME, provider)
        .map_err(|e| format!("Keyring error: {}", e))?;
    match entry.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Failed to retrieve key for {}: {}", provider, e)),
    }
}

/// Delete an API key from the OS keyring
pub fn delete_api_key(provider: &str) -> Result<(), String> {
    if provider.is_empty() {
        return Err("Provider name cannot be empty".to_string());
    }

    let entry = Entry::new(SERVICE_NAME, provider)
        .map_err(|e| format!("Keyring error: {}", e))?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()), // Already gone
        Err(e) => Err(format!("Failed to delete key for {}: {}", provider, e)),
    }
}

/// Check if keyring is available on this system
pub fn is_keyring_available() -> bool {
    Entry::new(SERVICE_NAME, "__health_check__")
        .map(|_| true) // Entry creation succeeds = keyring accessible
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore] // Requires OS keyring access — run manually with `cargo test -- --ignored`
    fn test_store_and_retrieve_key() {
        let provider = "test_provider_store_retrieve";
        let key = "test_api_key_12345";

        // Clean up before test
        let _ = delete_api_key(provider);

        // Store the key
        assert!(
            store_api_key(provider, key).is_ok(),
            "Failed to store API key"
        );

        // Retrieve the key
        let retrieved = get_api_key(provider).expect("Failed to retrieve key");
        assert_eq!(
            retrieved, Some(key.to_string()),
            "Retrieved key doesn't match stored key"
        );

        // Clean up after test
        let _ = delete_api_key(provider);
    }

    #[test]
    fn test_retrieve_nonexistent_key() {
        let provider = "test_provider_nonexistent_12345";

        // Clean up before test
        let _ = delete_api_key(provider);

        // Try to retrieve a key that doesn't exist
        let retrieved = get_api_key(provider).expect("Failed to call get_api_key");
        assert_eq!(retrieved, None, "Expected None for nonexistent key");
    }

    #[test]
    #[ignore] // Requires OS keyring access — run manually with `cargo test -- --ignored`
    fn test_delete_key() {
        let provider = "test_provider_delete";
        let key = "test_key_to_delete";

        // Store a key
        assert!(
            store_api_key(provider, key).is_ok(),
            "Failed to store API key"
        );

        // Verify it exists
        let before_delete = get_api_key(provider).expect("Failed to retrieve key before delete");
        assert!(before_delete.is_some(), "Key should exist before deletion");

        // Delete it
        assert!(
            delete_api_key(provider).is_ok(),
            "Failed to delete API key"
        );

        // Verify it's gone
        let after_delete = get_api_key(provider).expect("Failed to retrieve key after delete");
        assert_eq!(after_delete, None, "Key should not exist after deletion");
    }

    #[test]
    #[ignore] // Requires OS keyring access — run manually with `cargo test -- --ignored`
    fn test_overwrite_key() {
        let provider = "test_provider_overwrite";
        let key1 = "initial_key_value";
        let key2 = "updated_key_value";

        // Clean up before test
        let _ = delete_api_key(provider);

        // Store first key
        assert!(
            store_api_key(provider, key1).is_ok(),
            "Failed to store initial key"
        );

        // Overwrite with second key
        assert!(
            store_api_key(provider, key2).is_ok(),
            "Failed to overwrite key"
        );

        // Verify it's the new key
        let retrieved = get_api_key(provider).expect("Failed to retrieve key");
        assert_eq!(
            retrieved, Some(key2.to_string()),
            "Retrieved key should be the updated value"
        );

        // Clean up after test
        let _ = delete_api_key(provider);
    }

    #[test]
    fn test_empty_provider_validation() {
        let empty_provider = "";
        let key = "some_key";

        // Store should fail with empty provider
        assert!(
            store_api_key(empty_provider, key).is_err(),
            "Should reject empty provider for store"
        );

        // Get should fail with empty provider
        assert!(
            get_api_key(empty_provider).is_err(),
            "Should reject empty provider for get"
        );

        // Delete should fail with empty provider
        assert!(
            delete_api_key(empty_provider).is_err(),
            "Should reject empty provider for delete"
        );
    }

    #[test]
    fn test_empty_key_validation() {
        let provider = "test_provider";
        let empty_key = "";

        // Store should fail with empty key
        assert!(
            store_api_key(provider, empty_key).is_err(),
            "Should reject empty key for store"
        );
    }
}
