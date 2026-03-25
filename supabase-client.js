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

// ── Session token storage ─────────────────────────────────────
// Returns the best available JWT for the current session.
// Checks both the legacy Sleeper session (od_session_v1) and the new
// email-based Fantasy Wars session (fw_session_v1) from landing.html.
const SESSION_LS_KEY = 'od_session_v1';
const FW_SESSION_KEY  = 'fw_session_v1';

function getSessionToken() {
    // ── New email-based session (landing.html → fw-signup/fw-signin) ──
    try {
        const raw = localStorage.getItem(FW_SESSION_KEY);
        if (raw) {
            const s = JSON.parse(raw);
            // fw_session_v1 shape: { token, user: { ... } }
            if (s?.token) return s.token;
        }
    } catch {}

    // ── Legacy Sleeper session (login.html → get-session-token) ──
    try {
        const raw = localStorage.getItem(SESSION_LS_KEY);
        if (!raw) return null;
        const s = JSON.parse(raw);
        if (!s?.token || !s?.expiresAt) return null;
        // Treat token as expired 5 minutes early to avoid edge-case failures
        if (Date.now() >= new Date(s.expiresAt).getTime() - 5 * 60 * 1000) return null;
        return s.token;
    } catch { return null; }
}

// ── Bootstrap Supabase client ─────────────────────────────────
// Uses the session token (JWT) when available so RLS policies apply.
let _supabase = null;
let _supabaseToken = null;

function getClient() {
    if (typeof window.supabase === 'undefined') {
        console.warn('[OD] Supabase CDN not loaded — falling back to localStorage only');
        return null;
    }
    const token = getSessionToken();
    // Re-create client only when the token changes
    if (_supabase && _supabaseToken === token) return _supabase;
    const opts = token
        ? { global: { headers: { Authorization: `Bearer ${token}` } } }
        : {};
    _supabase      = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, opts);
    _supabaseToken = token;
    return _supabase;
}

function isConfigured() {
    return SUPABASE_URL !== 'YOUR_SUPABASE_URL' &&
           SUPABASE_ANON !== 'YOUR_SUPABASE_ANON_KEY';
}

// ── Username helper ───────────────────────────────────────────
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
    await db.from('users').upsert(
        { sleeper_username: username },
        { onConflict: 'sleeper_username', ignoreDuplicates: true }
    );
}

// ============================================================
// AUTH — Session token acquisition
// Called after every successful login to obtain a signed JWT
// that the Supabase RLS policies use for per-user enforcement.
// ============================================================
window.OD = window.OD || {};

/**
 * Acquire (or refresh) a session token from the get-session-token
 * Edge Function. Stores the result in localStorage.
 *
 * @param {string} username   - Sleeper username
 * @param {string} [password] - Required only for gifted accounts
 * @returns {{ token, expiresAt, isGifted } | null}
 */
window.OD.acquireSessionToken = async function(username, password) {
    if (!isConfigured() || !username) return null;
    try {
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/get-session-token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': SUPABASE_ANON,
            },
            body: JSON.stringify({ username, password: password || undefined }),
        });
        if (!resp.ok) return null;
        const session = await resp.json();
        if (!session?.token) return null;
        localStorage.setItem(SESSION_LS_KEY, JSON.stringify(session));
        // Reset cached client so next call picks up the new token
        _supabase = null;
        _supabaseToken = null;
        return session;
    } catch { return null; }
};

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

window.OD.loadCalendarEvents = async function(defaultEvents) {
    let local = null;
    try {
        const raw = localStorage.getItem(CALENDAR_LS_KEY);
        if (raw) local = JSON.parse(raw);
    } catch {}

    const username = getCurrentUsername();
    if (isConfigured() && username) {
        const remote = await dbLoadCalendarEvents(username);
        if (remote !== null) {
            const remoteIds = new Set(remote.map(e => e.id));
            const missingDefaults = (defaultEvents || []).filter(d => !remoteIds.has(d.id));
            const merged = [...remote, ...missingDefaults];
            localStorage.setItem(CALENDAR_LS_KEY, JSON.stringify(merged));
            return merged;
        }
    }

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

    localStorage.setItem(CALENDAR_LS_KEY, JSON.stringify(defaultEvents || []));
    return defaultEvents || [];
};

window.OD.saveCalendarEvents = function(events) {
    localStorage.setItem(CALENDAR_LS_KEY, JSON.stringify(events));
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
        if (remote !== null) return remote;
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
// Paginated: load the most recent `limit` messages (default 100),
// call with offset to page backwards through history.
// ============================================================

window.OD.sendDM = async function(toUsername, body) {
    const from = getCurrentUsername();
    const db = getClient();
    if (!db || !isConfigured() || !from) throw new Error('Not configured');
    await ensureUser(from);
    const { error } = await db.from('messages').insert({ from_username: from, to_username: toUsername, body });
    if (error) throw error;
};

window.OD.loadDMs = async function({ limit = 100, offset = 0 } = {}) {
    const username = getCurrentUsername();
    const db = getClient();
    if (!db || !isConfigured() || !username) return [];
    const { data, error } = await db
        .from('messages')
        .select('*')
        .or(`from_username.eq.${username},to_username.eq.${username}`)
        .order('created_at', { ascending: true })
        .range(offset, offset + limit - 1);
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
// GIFT USERS
// Password is hashed server-side (bcrypt) via the set-password
// Edge Function — no sensitive crypto happens in the browser.
// ============================================================

window.OD.createGiftUser = async function({ sleeperUsername, password, displayName }) {
    if (!isConfigured()) throw new Error('Supabase not configured');
    const token = getSessionToken();
    if (!token) throw new Error('You must be logged in to gift a dashboard');

    const resp = await fetch(`${SUPABASE_URL}/functions/v1/set-password`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'apikey': SUPABASE_ANON,
        },
        body: JSON.stringify({ username: sleeperUsername, password, displayName: displayName || undefined }),
    });
    const result = await resp.json();
    if (!resp.ok) throw new Error(result.error || 'Failed to create gift user');
};

// Check which usernames from a list already have dashboard accounts in Supabase.
// Returns a Set of usernames that have an account row.
window.OD.checkUsersAccess = async function(usernames) {
    const db = getClient();
    if (!db || !isConfigured() || !usernames || usernames.length === 0) return new Set();
    const { data } = await db
        .from('users')
        .select('sleeper_username')
        .in('sleeper_username', usernames);
    return new Set((data || []).map(u => u.sleeper_username));
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
    if (!isConfigured()) throw new Error('Supabase not configured');
    const token = getSessionToken();
    if (!token) throw new Error('You must be logged in to change your password');

    const resp = await fetch(`${SUPABASE_URL}/functions/v1/set-password`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'apikey': SUPABASE_ANON,
        },
        body: JSON.stringify({ username, password: newPassword }),
    });
    const result = await resp.json();
    if (!resp.ok) throw new Error(result.error || 'Failed to update password');
};

// ============================================================
// AI ANALYSIS
// ============================================================

// onChunk(partialText) is called progressively as tokens stream in.
// mock_draft type returns JSON and does not stream — onChunk is ignored for it.
// The returned { analysis } contains the full completed text.
window.OD.callAI = async function({ type, context, onChunk }) {
    let token = getSessionToken();

    // Auto-refresh expired session token for legacy Sleeper users
    if (!token) {
        try {
            const authRaw = localStorage.getItem('od_auth_v1');
            if (authRaw) {
                const auth = JSON.parse(authRaw);
                if (auth?.username) {
                    const session = await window.OD.acquireSessionToken(auth.username);
                    if (session?.token) token = session.token;
                }
            }
        } catch {}
    }

    if (!token) {
        throw new Error('Session expired. Please log out and log back in to continue using AI.');
    }

    const response = await fetch(`${SUPABASE_URL}/functions/v1/ai-analyze`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'apikey': SUPABASE_ANON,
        },
        body: JSON.stringify({ type, context }),
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `AI call failed (${response.status})`);
    }
    // mock_draft returns structured JSON — parse it directly, no streaming
    if (type === 'mock_draft') return response.json();
    // All other types stream plain text tokens
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let analysis = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        analysis += decoder.decode(value, { stream: true });
        if (onChunk) onChunk(analysis);
    }
    return { analysis };
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
// OWNER DNA PROFILES
// ============================================================
const DNA_LS_KEY = id => `od_owner_dna_v1_${id}`;

async function dbLoadDNA(username, leagueId) {
    const db = getClient();
    if (!db || !isConfigured() || !username) return null;
    const { data, error } = await db
        .from('owner_dna').select('dna_map')
        .eq('username', username).eq('league_id', leagueId).maybeSingle();
    if (error) { console.warn('[OD] dna load error', error); return null; }
    return data ? (data.dna_map || {}) : null;
}

async function dbSaveDNA(username, leagueId, dnaMap) {
    const db = getClient();
    if (!db || !isConfigured() || !username) return;
    await ensureUser(username);
    const { error } = await db.from('owner_dna').upsert(
        { username, league_id: leagueId, dna_map: dnaMap, updated_at: new Date().toISOString() },
        { onConflict: 'username,league_id' }
    );
    if (error) console.warn('[OD] dna save error', error);
}

window.OD.loadDNA = async function(leagueId) {
    let local = {};
    try {
        const raw = localStorage.getItem(DNA_LS_KEY(leagueId));
        if (raw) local = JSON.parse(raw);
    } catch {}

    const username = getCurrentUsername();
    if (isConfigured() && username) {
        const remote = await dbLoadDNA(username, leagueId);
        if (remote !== null) {
            const merged = { ...local, ...remote };
            localStorage.setItem(DNA_LS_KEY(leagueId), JSON.stringify(merged));
            return merged;
        }
    }
    return local;
};

window.OD.saveDNA = function(leagueId, dnaMap) {
    localStorage.setItem(DNA_LS_KEY(leagueId), JSON.stringify(dnaMap));
    const username = getCurrentUsername();
    if (isConfigured() && username) {
        dbSaveDNA(username, leagueId, dnaMap).catch(console.warn);
    }
};

// ============================================================
// LEAGUE INTELLIGENCE — shared per-team AI state across pages
// Populated by trade-calculator on every AI run.
// Read by mock draft, FA, and any future analysis context builders.
// ============================================================

window.OD.saveLeagueIntelligence = async function(leagueId, teams) {
    const db = getClient();
    if (!db || !isConfigured()) return;
    const rows = teams.map(t => ({
        league_id:    leagueId,
        owner_id:     t.ownerId,
        owner_name:   t.owner || null,
        tier:         t.tier || null,
        health_score: t.healthScore ?? null,
        posture:      t.posture || null,
        needs:        t.needs || [],
        strengths:    t.strengths || [],
        qb_count:     t.qbCount ?? null,
        record:       t.record || null,
        dna:          t.dna || null,
        updated_at:   new Date().toISOString(),
    }));
    const { error } = await db
        .from('league_intelligence')
        .upsert(rows, { onConflict: 'league_id,owner_id' });
    if (error) console.warn('[OD] league_intelligence save error', error);
};

window.OD.loadLeagueIntelligence = async function(leagueId) {
    const db = getClient();
    if (!db || !isConfigured()) return [];
    const { data, error } = await db
        .from('league_intelligence')
        .select('*')
        .eq('league_id', leagueId);
    if (error) { console.warn('[OD] league_intelligence load error', error); return []; }
    return data || [];
};

// ============================================================
// USER PROFILE — tier, platforms, onboarding status
//
// Required Supabase SQL (run once in SQL editor):
//   ALTER TABLE users ADD COLUMN IF NOT EXISTS tier text DEFAULT 'free';
//   ALTER TABLE users ADD COLUMN IF NOT EXISTS fantasy_platforms jsonb DEFAULT '[]';
//   ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_complete boolean DEFAULT false;
// ============================================================

window.OD.saveProfile = async function(profile) {
    const username = getCurrentUsername();
    const db = getClient();
    if (!db || !isConfigured() || !username) return;
    await ensureUser(username);
    const { error } = await db.from('users').update({
        tier:                profile.tier               || 'free',
        fantasy_platforms:   profile.platforms          || ['sleeper'],
        onboarding_complete: profile.onboardingComplete || false,
    }).eq('sleeper_username', username);
    if (error) console.warn('[OD] profile save error', error);
};

window.OD.loadProfile = async function() {
    const username = getCurrentUsername();
    const db = getClient();
    if (!db || !isConfigured() || !username) return null;
    const { data, error } = await db
        .from('users')
        .select('tier, fantasy_platforms, onboarding_complete')
        .eq('sleeper_username', username)
        .maybeSingle();
    if (error || !data) return null;
    return {
        tier:               data.tier               || 'free',
        platforms:          data.fantasy_platforms  || ['sleeper'],
        onboardingComplete: data.onboarding_complete || false,
    };
};

// ============================================================
// STATUS INDICATOR
// ============================================================
window.OD.status = function() {
    if (!isConfigured()) return console.log('[OD] Supabase not configured — using localStorage only');
    const db = getClient();
    if (!db) return console.log('[OD] Supabase CDN not loaded');
    const token = getSessionToken();
    console.log('[OD] Supabase connected:', SUPABASE_URL);
    console.log('[OD] Current user:', getCurrentUsername() || '(not logged in)');
    console.log('[OD] Session token:', token ? 'valid' : 'none — DB writes will be blocked by RLS');
};

// Auto-updates are now handled by the service worker (sw.js).
// The SW uses skipWaiting + clients.claim on activation, and
// index.html listens for the controllerchange event to show
// the gold banner and reload — works on browser and PWA.
