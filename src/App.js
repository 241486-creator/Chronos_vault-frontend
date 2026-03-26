import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import './App.css'; // Animations ke liye CSS zaroori hai

// APNA LIVE BACKEND LINK YAHAN DALO
const API_URL = "https://chronos-vault-backend.vercel.app";

function App() {
  const [siteName, setSiteName] = useState('');
  const [passwordText, setPasswordText] = useState('');
  const [vaultData, setVaultData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('SYSTEM_READY');

  // 1. Database se passwords mangwana
  const fetchPasswords = async () => {
    try {
      const response = await axios.get(`${API_URL}/get-passwords`);
      setVaultData(response.data);
      setStatus('DATA_SYNC_COMPLETE');
    } catch (err) {
      console.error("Fetch error:", err);
      setStatus('UPLINK_ERROR');
    }
  };

  useEffect(() => {
    fetchPasswords();
  }, []);

  // 2. Naya password save (Encrypt) karna
  const handleEncrypt = async () => {
    if (!siteName || !passwordText) {
      setStatus('INPUT_REQUIRED');
      return;
    }

    setLoading(true);
    setStatus('ENCRYPTING...');

    try {
      await axios.post(`${API_URL}/add-password`, {
        site_name: siteName,
        password_text: passwordText
      });

      setSiteName('');
      setPasswordText('');
      setStatus('IDENTITY_VERIFIED');
      fetchPasswords(); // List refresh karein
    } catch (err) {
      console.error("Encryption error:", err);
      setStatus('SERVER_OFFLINE');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="hacker-container">
      {/* Background Matrix Effect (Optional: Add via CSS) */}
      <div className="overlay"></div>

      <header className="terminal-header">
        <h1 className="glitch" data-text="CHRONOS VAULT">CHRONOS VAULT</h1>
        <div className="status-bar">
          <span className="blink">●</span> {status} | NODE_ISLAMABAD_ONLINE
        </div>
      </header>

      <main className="vault-interface">
        <section className="input-zone">
          <div className="input-group">
            <label>NODE_ID::</label>
            <input
              type="text"
              value={siteName}
              onChange={(e) => setSiteName(e.target.value.toUpperCase())}
              placeholder="ENTER_SITE_NAME..."
            />
          </div>

          <div className="input-group">
            <label>HASH_KEY::</label>
            <input
              type="password"
              value={passwordText}
              onChange={(e) => setPasswordText(e.target.value)}
              placeholder="ENTER_SECRET_KEY..."
            />
          </div>

          <button className="hacker-btn" onClick={handleEncrypt} disabled={loading}>
            {loading ? "PROCESSING..." : "EXECUTE_ENCRYPTION"}
          </button>
        </section>

        <section className="display-zone">
          <h2 className="section-title">DECRYPTED_LOGS:</h2>
          <div className="logs-container">
            {vaultData.length === 0 ? (
              <p className="no-data">NO_RECORDS_FOUND_IN_VAULT</p>
            ) : (
              vaultData.map((item, index) => (
                <div key={index} className="log-entry">
                  <span className="log-time">[{new Date(item.created_at).toLocaleTimeString()}]</span>
                  <span className="log-site"> SITE: {item.site_name}</span>
                  <span className="log-pass"> PASS: {item.password_text}</span>
                </div>
              ))
            )}
          </div>
        </section>
      </main>

      <footer className="terminal-footer">
        <p>© 2026 CHRONOS_SECURITY_SYSTEMS v2.0</p>
      </footer>
    </div>
  );
}

export default App;