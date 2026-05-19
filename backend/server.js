const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { body, validationResult } = require('express-validator');
require('dotenv').config();

const app = express();

// ==========================================
// SECURITY HEADERS (XSS, Clickjacking, etc)
// ==========================================
app.use(helmet({
    contentSecurityPolicy: false // React ke liye off
}));

// ==========================================
// REQUEST SIZE LIMIT (Large payload attacks)
// ==========================================
app.use(express.json({ limit: '10kb' }));

// ==========================================
// CORS
// ==========================================
app.use(cors({
    origin: [
        "https://chronos-vault-ultimate-v1.vercel.app",
        "https://frontend-seven-iota-99.vercel.app",
        "https://chronosvault.me"
    ],
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true
}));

// ==========================================
// RATE LIMITING - DDoS & Brute Force
// ==========================================

// Global rate limit - har IP ke liye
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // 100 requests per 15 min
    message: { error: "TOO_MANY_REQUESTS" },
    standardHeaders: true,
    legacyHeaders: false
});

// Login rate limit - Brute Force protection
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // sirf 5 login attempts
    message: { error: "TOO_MANY_LOGIN_ATTEMPTS_TRY_AFTER_15_MIN" },
    standardHeaders: true,
    legacyHeaders: false
});

// Register rate limit
const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3, // sirf 3 registrations per hour per IP
    message: { error: "TOO_MANY_REGISTER_ATTEMPTS" },
    standardHeaders: true,
    legacyHeaders: false
});

// Vault rate limit
const vaultLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 30, // 30 requests per minute
    message: { error: "VAULT_RATE_LIMIT_EXCEEDED" }
});

app.use(globalLimiter);

// ==========================================
// DATABASE
// ==========================================
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 10, // connection pool limit
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000
});

// ==========================================
// EMAIL TRANSPORTER
// ==========================================
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASS
    }
});

// ==========================================
// ENCRYPTION
// ==========================================
const ENCRYPTION_KEY = process.env.ENCRYPTION_SECRET || crypto.randomBytes(32).toString('hex');

function encryptData(text) {
    const iv = crypto.randomBytes(16);
    const key = Buffer.from(ENCRYPTION_KEY.slice(0, 32).padEnd(32, '0'));
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
}

function decryptData(encryptedText) {
    try {
        const parts = encryptedText.split(':');
        if (parts.length < 2) return encryptedText;
        const iv = Buffer.from(parts[0], 'hex');
        const encrypted = parts.slice(1).join(':');
        const key = Buffer.from(ENCRYPTION_KEY.slice(0, 32).padEnd(32, '0'));
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (e) {
        return '[DECRYPTION_FAILED]';
    }
}

// ==========================================
// INPUT VALIDATION MIDDLEWARE
// ==========================================
const validateRegister = [
    body('username')
        .trim()
        .isLength({ min: 3, max: 30 })
        .withMessage('Username 3-30 characters hona chahiye')
        .matches(/^[a-zA-Z0-9_]+$/)
        .withMessage('Username mein sirf letters, numbers aur underscore allowed hain'),
    body('email')
        .isEmail()
        .normalizeEmail()
        .withMessage('Valid email required'),
    body('password')
        .isLength({ min: 8 })
        .withMessage('Password minimum 8 characters hona chahiye')
        .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
        .withMessage('Password mein uppercase, lowercase aur number hona chahiye'),
    body('heir_email')
        .isEmail()
        .normalizeEmail()
        .withMessage('Valid heir email required')
];

const validateLogin = [
    body('email')
        .isEmail()
        .normalizeEmail()
        .withMessage('Valid email required'),
    body('password')
        .notEmpty()
        .withMessage('Password required')
        .isLength({ max: 100 })
        .withMessage('Password too long')
];

const validateSecret = [
    body('site_name')
        .trim()
        .isLength({ min: 1, max: 100 })
        .withMessage('Site name 1-100 characters'),
    body('secret_content')
        .notEmpty()
        .withMessage('Secret content required')
        .isLength({ max: 10000 })
        .withMessage('Secret too long')
];

// Validation error handler
const handleValidation = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            error: 'VALIDATION_FAILED',
            details: errors.array().map(e => e.msg)
        });
    }
    next();
};

// ==========================================
// DATABASE SETUP
// ==========================================
app.get('/setup-db', async (req, res) => {
    try {
        await pool.query(`
            DROP TABLE IF EXISTS vault_data CASCADE;
            DROP TABLE IF EXISTS users CASCADE;

            CREATE TABLE users (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                heir_email TEXT,
                dead_man_switch_days INT DEFAULT 30,
                last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                is_released BOOLEAN DEFAULT FALSE,
                switch_triggered BOOLEAN DEFAULT FALSE,
                failed_login_attempts INT DEFAULT 0,
                locked_until TIMESTAMP
            );

            CREATE TABLE vault_data (
                id SERIAL PRIMARY KEY,
                user_id INT REFERENCES users(id) ON DELETE CASCADE,
                site_name TEXT NOT NULL,
                secret_content TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- Indexes for performance
            CREATE INDEX idx_users_email ON users(email);
            CREATE INDEX idx_vault_user_id ON vault_data(user_id);
        `);
        res.json({ message: "DATABASE_REBUILT_SECURE" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// AUTH - REGISTER
// ==========================================
app.post('/register',
    registerLimiter,
    validateRegister,
    handleValidation,
    async (req, res) => {
        const { username, email, password, heir_email, switch_days } = req.body;

        try {
            // Check existing user
            const existing = await pool.query(
                'SELECT id FROM users WHERE email = $1 OR username = $2',
                [email, username]
            );
            if (existing.rows.length > 0) {
                return res.status(400).json({ error: "IDENTITY_TAKEN" });
            }

            const saltRounds = 12;
            const password_hash = await bcrypt.hash(password, saltRounds);
            const days = Math.min(Math.max(parseInt(switch_days) || 30, 1), 365);

            const result = await pool.query(
                `INSERT INTO users 
                 (username, email, password_hash, heir_email, dead_man_switch_days) 
                 VALUES ($1, $2, $3, $4, $5) 
                 RETURNING id, username, email, heir_email, dead_man_switch_days`,
                [username, email, password_hash, heir_email, days]
            );

            res.status(201).json({ message: "ACCESS_GRANTED", user: result.rows[0] });

        } catch (err) {
            console.error("Register Error:", err.message);
            res.status(500).json({ error: "AUTH_FAILED" });
        }
    }
);

// ==========================================
// AUTH - LOGIN
// ==========================================
app.post('/login',
    loginLimiter,
    validateLogin,
    handleValidation,
    async (req, res) => {
        const { email, password } = req.body;

        try {
            const result = await pool.query(
                'SELECT * FROM users WHERE email = $1', [email]
            );

            if (result.rows.length === 0) {
                // Timing attack prevention - still run bcrypt
                await bcrypt.hash('dummy', 10);
                return res.status(401).json({ error: "INVALID_CREDENTIALS" });
            }

            const user = result.rows[0];

            // Account lockout check
            if (user.locked_until && new Date(user.locked_until) > new Date()) {
                return res.status(423).json({ error: "ACCOUNT_LOCKED_TRY_LATER" });
            }

            const isValid = await bcrypt.compare(password, user.password_hash);

            if (!isValid) {
                // Increment failed attempts
                const attempts = user.failed_login_attempts + 1;
                const lockUntil = attempts >= 5
                    ? new Date(Date.now() + 15 * 60 * 1000) // Lock 15 min after 5 attempts
                    : null;

                await pool.query(
                    'UPDATE users SET failed_login_attempts = $1, locked_until = $2 WHERE id = $3',
                    [attempts, lockUntil, user.id]
                );

                return res.status(401).json({ error: "INVALID_CREDENTIALS" });
            }

            // Reset failed attempts on success
            await pool.query(
                `UPDATE users SET 
                 last_seen = NOW(), 
                 switch_triggered = FALSE,
                 failed_login_attempts = 0,
                 locked_until = NULL
                 WHERE id = $1`,
                [user.id]
            );

            const { password_hash, failed_login_attempts, locked_until, ...safeUser } = user;
            res.json({ message: "LOGIN_SUCCESSFUL", user: safeUser });

        } catch (err) {
            console.error("Login Error:", err.message);
            res.status(500).json({ error: "AUTH_FAILED" });
        }
    }
);

// ==========================================
// UPDATE SWITCH DAYS
// ==========================================
app.post('/update-switch-days', async (req, res) => {
    const { user_id, switch_days } = req.body;

    if (!user_id || !switch_days) {
        return res.status(400).json({ error: "MISSING_FIELDS" });
    }

    const days = Math.min(Math.max(parseInt(switch_days), 1), 365);

    try {
        await pool.query(
            'UPDATE users SET dead_man_switch_days = $1 WHERE id = $2',
            [days, user_id]
        );
        res.json({ message: "SWITCH_DAYS_UPDATED" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// VAULT - ADD SECRET
// ==========================================
app.post('/add-secret',
    vaultLimiter,
    validateSecret,
    handleValidation,
    async (req, res) => {
        const { user_id, site_name, secret_content } = req.body;

        if (!user_id) {
            return res.status(400).json({ error: "USER_ID_REQUIRED" });
        }

        try {
            // Verify user exists
            const userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [user_id]);
            if (userCheck.rows.length === 0) {
                return res.status(404).json({ error: "USER_NOT_FOUND" });
            }

            const encryptedSecret = encryptData(secret_content);
            const result = await pool.query(
                'INSERT INTO vault_data (user_id, site_name, secret_content) VALUES ($1, $2, $3) RETURNING *',
                [user_id, site_name.trim(), encryptedSecret]
            );
            res.status(201).json(result.rows[0]);
        } catch (err) {
            res.status(500).json({ error: "ENCRYPT_FAILED" });
        }
    }
);

// ==========================================
// VAULT - GET SECRETS
// ==========================================
app.get('/get-vault/:user_id', vaultLimiter, async (req, res) => {
    const user_id = parseInt(req.params.user_id);

    if (isNaN(user_id)) {
        return res.status(400).json({ error: "INVALID_USER_ID" });
    }

    try {
        const result = await pool.query(
            'SELECT * FROM vault_data WHERE user_id = $1 ORDER BY created_at DESC',
            [user_id]
        );
        const decryptedVault = result.rows.map(row => ({
            ...row,
            secret_content: decryptData(row.secret_content)
        }));
        res.json(decryptedVault);
    } catch (err) {
        res.status(500).json({ error: "FETCH_FAILED" });
    }
});

// ==========================================
// VAULT - DELETE SECRET
// ==========================================
app.delete('/delete-secret/:id', vaultLimiter, async (req, res) => {
    const id = parseInt(req.params.id);

    if (isNaN(id)) {
        return res.status(400).json({ error: "INVALID_ID" });
    }

    try {
        await pool.query('DELETE FROM vault_data WHERE id = $1', [id]);
        res.json({ message: "SECRET_DELETED" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// HEIR EMAIL FUNCTION
// ==========================================
async function sendHeirEmail(user, secrets) {
    const secretsList = secrets.map((s, i) =>
        `${i + 1}. ${s.site_name}: ${decryptData(s.secret_content)}`
    ).join('\n');

    await transporter.sendMail({
        from: `"ChronosVault System" <${process.env.GMAIL_USER}>`,
        to: user.heir_email,
        subject: `⚠️ ChronosVault: ${user.username} ke secrets - Dead Man's Switch Triggered`,
        html: `
        <div style="font-family:monospace;background:#000;color:#00ff41;padding:30px;border:1px solid #00ff41;">
            <h1 style="color:#00ff41;letter-spacing:5px;">CHRONOS_VAULT</h1>
            <h2 style="color:#ff4040;">⚠️ DEAD MAN'S SWITCH TRIGGERED</h2>
            <p style="color:#ccc;">
                User <strong style="color:#00ff41;">${user.username}</strong> (${user.email}) 
                ne <strong>${user.dead_man_switch_days} din</strong> se login nahi kiya.
            </p>
            <p style="color:#ccc;">Aap ko heir designate kiya gaya tha. Yeh saare secrets hain:</p>
            <div style="background:#001100;padding:20px;border:1px solid #00ff41;margin:20px 0;">
                <pre style="color:#00ff41;">${secretsList || 'Koi secrets nahi hain.'}</pre>
            </div>
            <p style="color:#888;font-size:12px;">
                Yeh email automatically bheja gaya hai ChronosVault Dead Man's Switch system se.
            </p>
        </div>`
    });
}

// ==========================================
// DEAD MAN'S SWITCH CRON
// ==========================================
app.get('/cron/check-switch', async (req, res) => {
    const authHeader = req.headers['authorization'];
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return res.status(401).json({ error: "UNAUTHORIZED" });
    }

    try {
        const result = await pool.query(`
            SELECT * FROM users 
            WHERE heir_email IS NOT NULL 
            AND switch_triggered = FALSE
            AND is_released = FALSE
            AND last_seen < NOW() - (dead_man_switch_days || ' days')::INTERVAL
        `);

        let triggered = 0;
        for (const user of result.rows) {
            try {
                const secrets = await pool.query(
                    'SELECT * FROM vault_data WHERE user_id = $1', [user.id]
                );
                await sendHeirEmail(user, secrets.rows);
                await pool.query(
                    'UPDATE users SET switch_triggered = TRUE WHERE id = $1', [user.id]
                );
                triggered++;
            } catch (e) {
                console.error(`Email failed for ${user.username}:`, e.message);
            }
        }
        res.json({ message: "CRON_COMPLETE", triggered });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// TEST HEIR EMAIL
// ==========================================
app.post('/test-heir-email/:user_id', async (req, res) => {
    const user_id = parseInt(req.params.user_id);
    if (isNaN(user_id)) return res.status(400).json({ error: "INVALID_ID" });

    try {
        const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [user_id]);
        if (userResult.rows.length === 0) return res.status(404).json({ error: "USER_NOT_FOUND" });
        const user = userResult.rows[0];
        const secrets = await pool.query('SELECT * FROM vault_data WHERE user_id = $1', [user_id]);
        await sendHeirEmail(user, secrets.rows);
        res.json({ message: "TEST_EMAIL_SENT" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 404 HANDLER
// ==========================================
app.use((req, res) => {
    res.status(404).json({ error: "ROUTE_NOT_FOUND" });
});

// ==========================================
// ERROR HANDLER
// ==========================================
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
});

// ==========================================
// SERVER
// ==========================================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`ChronosVault Secure Server on port ${PORT}`));

module.exports = app;