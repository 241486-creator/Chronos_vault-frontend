import React, { useState, useEffect } from 'react';
import CryptoJS from 'crypto-js';
import './App.css';

function App() {
  // --- CONFIG (YAHA APNA LINK DALO) ---
  const API_URL = "https://chronos-vault-backend.vercel.app";
  const MASTER_CODE = "1234";
  const SECRET_KEY = "CHRONOS_SUPER_SECRET_123";

  // --- STATES ---
  const [site, setSite] = useState("");
  const [pwd, setPwd] = useState("");
  const [logs, setLogs] = useState(["[SYSTEM_BOOT_READY]", "[NODE_ISLAMABAD_ONLINE]"]);
  const [vaultData, setVaultData] = useState([]);
  const [showTable, setShowTable] = useState(false);
  const [visiblePasswords, setVisiblePasswords] = useState({});
  const [showInputPass, setShowInputPass] = useState(false);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [masterInput, setMasterInput] = useState("");

  // --- MATRIX EFFECT ---
  useEffect(() => {
    const canvas = document.getElementById('matrix');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const letters = "011011010101";
    const fontSize = 18;
    const columns = canvas.width / fontSize;
    const drops = Array(Math.floor(columns)).fill(1);
    const draw = () => {
      ctx.fillStyle = "rgba(0, 0, 0, 0.05)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#00ff41";
      ctx.font = fontSize + "px monospace";
      drops.forEach((y, i) => {
        const text = letters[Math.floor(Math.random() * letters.length)];
        ctx.fillText(text, i * fontSize, y * fontSize);
        if (y * fontSize > canvas.height && Math.random() > 0.975) drops[i] = 0;
        drops[i]++;
      });
    };
    const interval = setInterval(draw, 40);
    return () => clearInterval(interval);
  }, [isAuthorized]);

  // --- FUNCTIONS ---
  const handleLogin = () => {
    if (masterInput === MASTER_CODE) {
      setIsAuthorized(true);
      setLogs(prev => [`> IDENTITY_VERIFIED`, ...prev]);
    } else {
      alert("ACCESS_DENIED");
      setMasterInput("");
    }
  };

  const savePassword = async () => {
    if (!site || !pwd) return;
    const encryptedText = CryptoJS.AES.encrypt(pwd, SECRET_KEY).toString();
    try {
      const res = await fetch(`${API_URL}/add-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site_name: site, password_text: encryptedText })
      });
      if (res.ok) {
        setLogs(prev => [`> DATA_ENCRYPTED: ${site}`, ...prev]);
        setSite(""); setPwd("");
        fetchVault();
      }
    } catch (e) { setLogs(prev => [`> UPLINK_ERROR`, ...prev]); }
  };

  const fetchVault = async () => {
    try {
      const res = await fetch(`${API_URL}/get-passwords`);
      const data = await res.json();
      setVaultData(Array.isArray(data) ? data : []);
      setShowTable(true);
      setLogs(prev => [`> DECRYPTED: ${data.length} NODES`, ...prev]);
    } catch (e) { setLogs(prev => [`> ACCESS_DENIED`, ...prev]); }
  };

  const deleteNode = async (id) => {
    try {
      await fetch(`${API_URL}/delete-password/${id}`, { method: 'DELETE' });
      setLogs(prev => [`> PURGED: NODE_${id}`, ...prev]);
      fetchVault();
    } catch (e) { setLogs(prev => [`> DELETE_FAILED`, ...prev]); }
  };

  const getDecryptedPassword = (cipherText) => {
    try {
      const bytes = CryptoJS.AES.decrypt(cipherText, SECRET_KEY);
      return bytes.toString(CryptoJS.enc.Utf8) || "DECRYPT_ERR";
    } catch (e) { return "ERR"; }
  };

  if (!isAuthorized) {
    return (
      <div className="hacker-screen login-gate">
        <canvas id="matrix"></canvas>
        <div className="login-box">
          <div className="header-tag">IDENTITY_CHECK</div>
          <h2 className="glow-text">ENTER_MASTER_KEY</h2>
          <input type="password" className="master-input" value={masterInput} onChange={(e) => setMasterInput(e.target.value)} onKeyPress={(e) => e.key === 'Enter' && handleLogin()} autoFocus />
          <button className="auth-trigger" onClick={handleLogin}>VERIFY_ID</button>
        </div>
      </div>
    );
  }

  return (
    <div className="hacker-screen">
      <canvas id="matrix"></canvas>
      <div className="scanlines"></div>
      <div className="ui-overlay">
        <div className="float-stats left">
          <div className="header-tag">SYSTEM_MONITOR</div>
          <div className="log-scroll">
            {logs.map((log, i) => <div key={i} className="log-line">{log}</div>)}
          </div>
        </div>
        <div className="center-interface">
          <h1 className="main-logo">CHRONOS<span>VAULT</span></h1>
          <div className="input-arena">
            <div className="cyber-field">
              <span className="prefix">NODE::</span>
              <input value={site} onChange={(e) => setSite(e.target.value)} placeholder="STATION" />
            </div>
            <div className="cyber-field">
              <span className="prefix">HASH::</span>
              <input type={showInputPass ? "text" : "password"} value={pwd} onChange={(e) => setPwd(e.target.value)} placeholder="KEY" />
              <button className="input-eye-fancy" onClick={() => setShowInputPass(!showInputPass)}>{showInputPass ? "HIDE" : "SHOW"}</button>
            </div>
            <div className="btn-group-horizontal">
              <button className="auth-trigger" onClick={savePassword}>ENCRYPT</button>
              <button className="auth-trigger decrypt" onClick={fetchVault}>DECRYPT</button>
            </div>
          </div>
          {showTable && (
            <div className="data-table-container">
              <table className="cyber-table">
                <thead><tr><th>NODE</th><th>KEY_HASH</th><th>ACTION</th></tr></thead>
                <tbody>
                  {vaultData.map((d) => (
                    <tr key={d.id}>
                      <td>{d.site_name}</td>
                      <td className="pass-text">{visiblePasswords[d.id] ? getDecryptedPassword(d.password_text) : "••••••••"}</td>
                      <td>
                        <button className="eye-btn-fancy" onClick={() => setVisiblePasswords(p => ({ ...p, [d.id]: !p[d.id] }))}>VIEW</button>
                        <button className="del-btn-fancy" onClick={() => deleteNode(d.id)}>TERM</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="float-stats right">
          <div className="header-tag">SECURITY</div>
          <div className="radar-circle"><div className="radar-sweep"></div></div>
        </div>
      </div>
    </div>
  );
}

export default App;