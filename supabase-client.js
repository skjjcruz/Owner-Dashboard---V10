// ============================================================
// Owner Dashboard — Supabase Data Layer
// Loaded by every HTML page via <script src="supabase-client.js">
//
// HOW TO CONFIGURE
//   1. Go to supabase.com → your project → Settings → API
//   2. Copy "Project URL" and "anon public" key
//   3. Paste them below
// ============================================================

const SUPABASE_URL  = 'https://sxshiqyxhhifvtfqawbq.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4c2hpcXl4aGhpZnZ0ZnFhd2JxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MTExMzAsImV4cCI6MjA4ODI4NzEzMH0.zJi9W986ZLaANiZN6pt6ReFwaQU6yPeidsERIWo2ibI';

// ── Bootstrap Supabase client (loaded via CDN in each HTML file) ──
let _supabase = null;
function getClient() {
    if (!_supabase) {
        if (typeof window.supabase === 'undefined') {
            console.warn('[OD] Supabase CDN not loaded — falling back to localStorage only');
            return null;
        }
        _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
    }
    return _supabase;
}

// Returns true when the keys look real (not placeholders)
function isConfigured() {
    return SUPABASE_URL !== 'YOUR_SUPABASE_URL' &&
           SUPABASE_ANON !== 'YOUR_SUPABASE_ANON_KEY';
}

// ── Username helper ───────────────────────────────────────────
// Reads the Sleeper username that login.html stored.
function getCurrentUsername() {
    try {
        const raw = localStorage.getItem('od_auth_v1');
        if (!raw) return null;
        const auth = JSON.parse(raw);
        return auth?.sleeperUsername || auth?.username || null;
    } catch { return null; }
}

// ── Ensure the user row exists ────────────────────────────────
async function ensureUser(username) {
    const db = getClient();
    if (!db || !username) return;
    // upsert so first-time owners get a row without error
    await db.from('users').upsert(
        { sleeper_username: username },
        { onConflict: 'sleeper_username', ignoreDuplicates: true }
    );
}

// ============================================================
// CALENDAR EVENTS
// ============================================================
const CALENDAR_LS_KEY = 'od_calendar_events';

async function dbLoadCalendarEvents(username) {
    const db = getClient();
    if (!db || !isConfigured() || !username) return null;
    const { data, error } = await db
        .from('calendar_events')
        .select('*')
        .eq('username', username);
    if (error) { console.warn('[OD] calendar load error', error); return null; }
    return data.map(row => ({
        id:      row.id,
        title:   row.title,
        date:    row.date,
        time:    row.time,
        league:  row.league,
        details: row.details
    }));
}

async function dbSaveCalendarEvents(username, events) {
    const db = getClient();
    if (!db || !isConfigured() || !username) return;
    await ensureUser(username);

    // Upsert all events for this user
    const rows = events.map(e => ({
        id: e.id, username, title: e.title, date: e.date,
        time: e.time || '', league: e.league || '', details: e.details || ''
    }));
    if (rows.length > 0) {
        const { error } = await db.from('calendar_events').upsert(rows, { onConflict: 'id' });
        if (error) console.warn('[OD] calendar save error', error);
    }

    // Delete removed events
    const { data: existing } = await db
        .from('calendar_events').select('id').eq('username', username);
    const keepIds = new Set(events.map(e => e.id));
    const toDelete = (existing || []).map(r => r.id).filter(id => !keepIds.has(id));
    if (toDelete.length > 0) {
        await db.from('calendar_events').delete().in('id', toDelete);
    }
}

// Public API — wraps Supabase with localStorage fallback
window.OD = window.OD || {};

window.OD.loadCalendarEvents = async function(defaultEvents) {
    // Always read localStorage first (instant, works offline)
    let local = null;
    try {
        const raw = localStorage.getItem(CALENDAR_LS_KEY);
        if (raw) local = JSON.parse(raw);
    } catch {}

    const username = getCurrentUsername();
    if (isConfigured() && username) {
        const remote = await dbLoadCalendarEvents(username);
        if (remote !== null) {
            // Merge remote + any new defaults not already in remote
            const remoteIds = new Set(remote.map(e => e.id));
            const missingDefaults = (defaultEvents || []).filter(d => !remoteIds.has(d.id));
            const merged = [...remote, ...missingDefaults];
            localStorage.setItem(CALENDAR_LS_KEY, JSON.stringify(merged));
            return merged;
        }
    }

    // Fallback to localStorage
    if (local) {
        const localIds = new Set(local.map(e => e.id));
        const missing = (defaultEvents || []).filter(d => !localIds.has(d.id));
        if (missing.length > 0) {
            const merged = [...local, ...missing];
            localStorage.setItem(CALENDAR_LS_KEY, JSON.stringify(merged));
            return merged;
        }
        return local;
    }

    // First ever load — seed defaults
    localStorage.setItem(CALENDAR_LS_KEY, JSON.stringify(defaultEvents || []));
    return defaultEvents || [];
};

window.OD.saveCalendarEvents = function(events) {
    // Write to localStorage immediately (sync, works offline)
    localStorage.setItem(CALENDAR_LS_KEY, JSON.stringify(events));
    // Persist to Supabase in the background
    const username = getCurrentUsername();
    if (isConfigured() && username) {
        dbSaveCalendarEvents(username, events).catch(console.warn);
    }
};

// ============================================================
// EARNINGS
// ============================================================
const EARNINGS_LS_KEY = 'od_earnings_entries';

async function dbLoadEarnings(username) {
    const db = getClient();
    if (!db || !isConfigured() || !username) return null;
    const { data, error } = await db
        .from('earnings').select('*').eq('username', username);
    if (error) { console.warn('[OD] earnings load error', error); return null; }
    return data.map(row => ({
        id: row.id, year: row.year, league: row.league,
        description: row.description, amount: row.amount
    }));
}

async function dbSaveEarnings(username, entries) {
    const db = getClient();
    if (!db || !isConfigured() || !username) return;
    await ensureUser(username);

    if (entries.length > 0) {
        const rows = entries.map(e => ({
            id: e.id, username, year: e.year, league: e.league || '',
            description: e.description || '', amount: e.amount
        }));
        const { error } = await db.from('earnings').upsert(rows, { onConflict: 'id' });
        if (error) console.warn('[OD] earnings save error', error);
    }

    // Delete removed entries
    const { data: existing } = await db.from('earnings').select('id').eq('username', username);
    const keepIds = new Set(entries.map(e => e.id));
    const toDelete = (existing || []).map(r => r.id).filter(id => !keepIds.has(id));
    if (toDelete.length > 0) {
        await db.from('earnings').delete().in('id', toDelete);
    }
}

window.OD.loadEarnings = async function() {
    let local = null;
    try {
        const raw = localStorage.getItem(EARNINGS_LS_KEY);
        if (raw) local = JSON.parse(raw);
    } catch {}

    const username = getCurrentUsername();
    if (isConfigured() && username) {
        const remote = await dbLoadEarnings(username);
        if (remote !== null) {
            localStorage.setItem(EARNINGS_LS_KEY, JSON.stringify(remote));
            return remote;
        }
    }
    return local || [];
};

window.OD.saveEarnings = function(entries) {
    localStorage.setItem(EARNINGS_LS_KEY, JSON.stringify(entries));
    const username = getCurrentUsername();
    if (isConfigured() && username) {
        dbSaveEarnings(username, entries).catch(console.warn);
    }
};

// ============================================================
// FREE AGENCY TARGETS
// ============================================================
const FA_LS_KEY = id => `od_fa_targets_v1_${id}`;

async function dbLoadTargets(username, leagueId) {
    const db = getClient();
    if (!db || !isConfigured() || !username) return null;
    const { data, error } = await db
        .from('fa_targets').select('*')
        .eq('username', username).eq('league_id', leagueId).maybeSingle();
    if (error) { console.warn('[OD] fa load error', error); return null; }
    if (!data) return null;
    return { startingBudget: data.starting_budget, targets: data.targets || [] };
}

async function dbSaveTargets(username, leagueId, faData) {
    const db = getClient();
    if (!db || !isConfigured() || !username) return;
    await ensureUser(username);
    const { error } = await db.from('fa_targets').upsert(
        {
            username, league_id: leagueId,
            starting_budget: faData.startingBudget,
            targets: faData.targets,
            updated_at: new Date().toISOString()
        },
        { onConflict: 'username,league_id' }
    );
    if (error) console.warn('[OD] fa save error', error);
}

window.OD.loadTargets = async function(leagueId) {
    let local = null;
    try {
        const raw = localStorage.getItem(FA_LS_KEY(leagueId));
        if (raw) local = JSON.parse(raw);
    } catch {}

    const username = getCurrentUsername();
    if (isConfigured() && username) {
        const remote = await dbLoadTargets(username, leagueId);
        if (remote !== null) {
            // Don't overwrite localStorage here — the caller may have fresher data
            // (e.g. a target added just before an auto-reload). saveTargets() handles sync.
            return remote;
        }
    }
    return local || { startingBudget: 1000, targets: [] };
};

window.OD.saveTargets = function(leagueId, data) {
    localStorage.setItem(FA_LS_KEY(leagueId), JSON.stringify(data));
    const username = getCurrentUsername();
    if (isConfigured() && username) {
        dbSaveTargets(username, leagueId, data).catch(console.warn);
    }
};

// ============================================================
// DISPLAY NAME
// ============================================================
const DISPLAY_NAME_LS_KEY = 'od_display_name';

window.OD.loadDisplayName = async function() {
    const username = getCurrentUsername();
    if (isConfigured() && username) {
        const db = getClient();
        const { data } = await db.from('users').select('display_name').eq('sleeper_username', username).maybeSingle();
        if (data && data.display_name) {
            localStorage.setItem(DISPLAY_NAME_LS_KEY, data.display_name);
            return data.display_name;
        }
    }
    return localStorage.getItem(DISPLAY_NAME_LS_KEY) || '';
};

window.OD.saveDisplayName = function(name) {
    localStorage.setItem(DISPLAY_NAME_LS_KEY, name);
    const username = getCurrentUsername();
    if (isConfigured() && username) {
        const db = getClient();
        ensureUser(username).then(() => {
            db.from('users').update({ display_name: name || null }).eq('sleeper_username', username).then(({ error }) => {
                if (error) console.warn('[OD] display_name save error', error);
            });
        }).catch(console.warn);
    }
};

// ============================================================
// DIRECT MESSAGES
// ============================================================

window.OD.sendDM = async function(toUsername, body) {
    const from = getCurrentUsername();
    const db = getClient();
    if (!db || !isConfigured() || !from) throw new Error('Not configured');
    await ensureUser(from);
    const { error } = await db.from('messages').insert({ from_username: from, to_username: toUsername, body });
    if (error) throw error;
};

window.OD.loadDMs = async function() {
    const username = getCurrentUsername();
    const db = getClient();
    if (!db || !isConfigured() || !username) return [];
    const { data, error } = await db
        .from('messages')
        .select('*')
        .or(`from_username.eq.${username},to_username.eq.${username}`)
        .order('created_at', { ascending: true });
    if (error) return [];
    return data || [];
};

window.OD.markDMsRead = async function(fromUsername) {
    const username = getCurrentUsername();
    const db = getClient();
    if (!db || !isConfigured() || !username) return;
    await db.from('messages')
        .update({ read: true })
        .eq('to_username', username)
        .eq('from_username', fromUsername)
        .eq('read', false);
};

// ============================================================
// GIFT USERS — create a personalised dashboard for a league mate
// ============================================================

// Hash a password (same SHA-256 approach as login.html)
async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Create (or update) a gifted user row in Supabase
window.OD.createGiftUser = async function({ sleeperUsername, password, displayName }) {
    const db = getClient();
    if (!db || !isConfigured()) throw new Error('Supabase not configured');

    const passwordHash = await hashPassword(password);

    const { error } = await db.from('users').upsert(
        {
            sleeper_username: sleeperUsername,
            password_hash: passwordHash,
            display_name: displayName || null,
            is_gifted: true,
        },
        { onConflict: 'sleeper_username' }
    );
    if (error) throw error;
};

// Check Supabase for a user's password hash (used by login for gifted users)
window.OD.verifySupabasePassword = async function(username, password) {
    const db = getClient();
    if (!db || !isConfigured()) return false;
    const { data, error } = await db
        .from('users')
        .select('password_hash, is_gifted')
        .eq('sleeper_username', username)
        .maybeSingle();
    if (error || !data || !data.password_hash) return false;
    const inputHash = await hashPassword(password);
    return {
        match: data.password_hash === inputHash,
        isGifted: data.is_gifted || false,
    };
};

// Update password hash in Supabase (for change-password feature)
window.OD.updatePassword = async function(username, newPassword) {
    const db = getClient();
    if (!db || !isConfigured() || !username) return;
    const passwordHash = await hashPassword(newPassword);
    const { error } = await db
        .from('users')
        .update({ password_hash: passwordHash, is_gifted: false })
        .eq('sleeper_username', username);
    if (error) throw error;
};

// ============================================================
// AI ANALYSIS — hidden beta feature
// Calls the Supabase Edge Function which proxies Claude API.
// Enabled by setting localStorage key: od_ai_beta = 'true'
// ============================================================

window.OD.callAI = async function({ type, context }) {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/ai-analyze`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SUPABASE_ANON}`,
            'apikey': SUPABASE_ANON,
        },
        body: JSON.stringify({ type, context }),
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `AI call failed (${response.status})`);
    }
    return response.json(); // { analysis: string }
};

window.OD.saveAIAnalysis = async function(leagueId, type, contextSummary, analysis) {
    const username = getCurrentUsername();
    const db = getClient();
    if (!db || !isConfigured() || !username) return;
    await ensureUser(username);
    const { error } = await db.from('ai_analysis').insert({
        username, league_id: leagueId, type,
        context_summary: contextSummary || '',
        analysis,
    });
    if (error) console.warn('[OD] ai_analysis save error', error);
};

window.OD.loadAIHistory = async function(leagueId) {
    const username = getCurrentUsername();
    const db = getClient();
    if (!db || !isConfigured() || !username) return [];
    const { data, error } = await db
        .from('ai_analysis')
        .select('id, type, context_summary, analysis, created_at')
        .eq('username', username)
        .eq('league_id', leagueId)
        .order('created_at', { ascending: false })
        .limit(20);
    if (error) return [];
    return data || [];
};

// ============================================================
// STATUS INDICATOR (injected into page for easy debugging)
// ============================================================
window.OD.status = function() {
    if (!isConfigured()) return console.log('[OD] Supabase not configured — using localStorage only');
    const db = getClient();
    if (!db) return console.log('[OD] Supabase CDN not loaded');
    console.log('[OD] Supabase connected:', SUPABASE_URL);
    console.log('[OD] Current user:', getCurrentUsername() || '(not logged in)');
};

// ============================================================
// AUTO-UPDATE POLLING
// Polls this page's own URL via HEAD every 2 minutes.
// When the ETag/Last-Modified changes (new deploy on GitHub
// Pages), shows a brief toast then silently reloads — so all
// owners always run the latest version without manual refresh.
// ============================================================
(function startAutoUpdatePoller() {
    if (typeof fetch === 'undefined' || typeof window === 'undefined') return;

    let baseline = null;

    async function getSignature() {
        try {
            const r = await fetch(location.href, { method: 'HEAD', cache: 'no-store' });
            // Prefer ETag; fall back to Last-Modified
            return r.headers.get('etag') || r.headers.get('last-modified') || null;
        } catch { return null; }
    }

    function reload() {
        const el = document.createElement('div');
        el.textContent = '⚡ Updating to latest version...';
        el.style.cssText = [
            'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:99999',
            'background:#D4AF37', 'color:#0A0A0A',
            'font-family:Oswald,sans-serif', 'font-weight:700',
            'font-size:0.82rem', 'letter-spacing:0.06em',
            'text-align:center', 'padding:0.55rem', 'pointer-events:none'
        ].join(';');
        document.body.appendChild(el);
        setTimeout(() => location.reload(), 1500);
    }

    // Wait 5 s for page to fully settle, then capture baseline
    setTimeout(async () => {
        baseline = await getSignature();
        setInterval(async () => {
            if (!baseline) { baseline = await getSignature(); return; }
            const current = await getSignature();
            if (current && current !== baseline) reload();
        }, 2 * 60 * 1000); // poll every 2 minutes
    }, 5000);
})();
