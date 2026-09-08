use anyhow::{Context, Result};
use keyring::Entry;

const SERVICE_NAME: &str = "com.slottd.briefcase";

pub struct KeyringStore {
    service: String,
}

impl Default for KeyringStore {
    fn default() -> Self {
        Self {
            service: SERVICE_NAME.to_string(),
        }
    }
}

impl KeyringStore {
    pub fn new(service: &str) -> Self {
        Self {
            service: service.to_string(),
        }
    }

    /// Stores a secret (e.g. admin passphrase, signing key) in the OS Keyring.
    pub fn set_secret(&self, key: &str, secret: &str) -> Result<()> {
        let entry = Entry::new(&self.service, key)
            .context("Failed to initialize OS keyring entry")?;
        entry.set_password(secret)
            .context("Failed to store password in OS keyring")?;
        Ok(())
    }

    /// Retrieves a secret from the OS Keyring.
    pub fn get_secret(&self, key: &str) -> Result<Option<String>> {
        let entry = Entry::new(&self.service, key)
            .context("Failed to initialize OS keyring entry")?;
        match entry.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(anyhow::anyhow!("Keyring error: {}", e)),
        }
    }

    /// Deletes a secret from the OS Keyring.
    pub fn delete_secret(&self, key: &str) -> Result<()> {
        let entry = Entry::new(&self.service, key)
            .context("Failed to initialize OS keyring entry")?;
        match entry.delete_credential() {
            Ok(_) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(anyhow::anyhow!("Failed to delete credential: {}", e)),
        }
    }
}
