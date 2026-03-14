// ============================================================
// Owner Dashboard — AI Analysis Edge Function  [v3]
// Supabase Edge Function: /functions/v1/ai-analyze
//
// DEPLOY:
//   supabase functions deploy ai-analyze
//
// SET SECRET:
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
// ============================================================

import Anthropic from 'npm:@anthropic-ai/sdk';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── Prompt builders ───────────────────────────────────────────────────────────

function buildSystemPrompt(): string {
    return `You are an elite dynasty fantasy football analyst with deep expertise in player values, team-building strategy, and trade negotiation psychology. You analyze leagues with the precision of a sports analytics team combined with the strategic instinct of a seasoned GM.

You have access to live data: Sleeper rosters and standings, FantasyCalc dynasty player values, and behavioral profiles of each owner (their DNA/trading personality derived from actual trade history).

Your analysis must be:
- Specific and data-driven — name owners, cite records, reference actual roster compositions
- Actionable — concrete recommendations an owner can act on today
- Psychologically sharp — factor in owner DNA and negotiation leverage
- Confident and direct — write like a seasoned scout, not a chatbot

Format with **bold headers** for each section. Keep total response under 600 words.`;
}

function formatTeamsForPrompt(teams: any[]): string {
    return teams.map(t => {
        const flag = t.isMyTeam ? ' ← MY TEAM' : '';
        return `• ${t.owner} (${t.record}) | ${t.tier} | Health: ${t.healthScore}/100 | ${t.weeklyPts} pts/wk | DNA: ${t.dna || 'Unknown'} | Posture: ${t.posture || 'N/A'}${flag}
  Strengths: ${(t.strengths || []).join(', ') || 'none'}
  Needs: ${(t.needs || []).join(', ') || 'none'} (positions marked * are critical deficits)`;
    }).join('\n');
}

function buildLeaguePrompt(ctx: any): string {
    return `Analyze this dynasty fantasy football league.

**League:** ${ctx.leagueName} | Season: ${ctx.season} | ${ctx.teams.length} teams
**My Team:** ${ctx.myOwner}

**TEAM DATA:**
${formatTeamsForPrompt(ctx.teams)}

Provide:
**LEAGUE LANDSCAPE** — 3-4 sentence overview of competitive balance
**POWER RANKINGS** — Top 3 teams and specifically why they're winning
**REBUILDERS TO WATCH** — Teams in rebuild mode with the most upside
**DANGER ZONE** — Teams in trouble and why
**KEY STORYLINES** — 2-3 compelling narratives in this league right now
**CHAMPIONSHIP WINDOW** — Who wins this league over the next 1-3 years and why`;
}

function buildTeamPrompt(ctx: any): string {
    const t = ctx.team;
    const isMyTeam = t.isMyTeam === true;

    const rosterStr = (t.roster || []).map((p: any) =>
        `  ${p.pos} | ${p.name} (${p.team}) | Value: ${p.value}${p.isElite ? ' ★ELITE' : ''}`
    ).join('\n');

    // Build detailed pick breakdown with per-year flagging
    const pa = t.picksAssessment;
    let pickDetail = t.picksText || 'No pick data available';
    if (pa && pa.pickCountByYear && pa.pickYears) {
        const yearLines = (pa.pickYears as string[]).map((yr: string) => {
            const count = pa.pickCountByYear[yr] ?? 0;
            const firstCount = pa.pickCountByYearRound?.[yr]?.[1] ?? 0;
            if (count === 0) return `  ${yr}: ⚠️ ZERO PICKS — cannot participate in ${yr} rookie draft`;
            const firstNote = firstCount > 0 ? ` (${firstCount} first-round${firstCount > 1 ? 's' : ''} 🔑)` : ' (no 1st rounders)';
            return `  ${yr}: ${count} pick${count > 1 ? 's' : ''}${firstNote}`;
        }).join('\n');
        pickDetail = `${t.picksText}\nYear-by-year breakdown:\n${yearLines}`;
    }

    // Top 10 most valuable players for value-anchoring trade advice
    const topValues = (t.roster || [])
        .slice(0, 10)
        .map((p: any) => `${p.name} (${p.pos}, ${p.value})`)
        .join(', ');

    const negotiationSection = isMyTeam
        ? `**MY NEGOTIATION STRATEGY** — I am ${t.owner}. Based on my ${t.dna} DNA and current roster situation, how should I approach trade negotiations? What leverage do I have, what should I lead with, and what traps should I avoid?`
        : `**NEGOTIATION PLAYBOOK** — ${ctx.myOwner ? `I am ${ctx.myOwner} looking to trade with ${t.owner}.` : ''} Based on ${t.owner}'s ${t.dna} DNA profile, how should I approach negotiating with this owner? What buttons to push, what to avoid, how to frame offers?`;

    return `Provide a comprehensive scouting report on **${t.owner}**'s team in ${ctx.leagueName}.${isMyTeam ? ' This is MY OWN team — give me honest self-assessment and first-person strategic advice.' : ''}

**TEAM OVERVIEW:** ${t.record} | ${t.tier} | Health: ${t.healthScore}/100 | ${t.weeklyPts} pts/wk | Posture: ${t.posture}
**OWNER DNA:** ${t.dna}${t.dnaDescription ? ` — ${t.dnaDescription}` : ''}
**STATED NEEDS:** ${(t.needs || []).join(', ') || 'none identified'}
**STATED STRENGTHS:** ${(t.strengths || []).join(', ') || 'none identified'}
**DRAFT CAPITAL:** ${pickDetail}
**FAAB:** ${t.faabText || (t.waiverBudget > 0 ? `$${t.faabRemaining} of $${t.waiverBudget} remaining` : 'No FAAB system')}

**ROSTER (by position, sorted by value — scale 0-10,000):**
${rosterStr || 'No roster data available'}

**TOP 10 BY VALUE:** ${topValues || 'N/A'}
${ctx.myOwner && !isMyTeam ? `**I am:** ${ctx.myOwner}\n` : ''}

TRADE RECOMMENDATION RULES (strictly enforce):
- Values are on a 0-10,000 scale. Only propose trades where combined values are within ~20% of each other.
- Never suggest offering a low-value player for a clearly higher-value target (e.g. do not offer a 1,500-value DB for a 4,000-value RB).
- Respect positional market rates: elite RBs and QBs command premium return; DBs, LBs, and depth pieces do not.
- A player with a high value (4,000+) is likely a borderline elite — do not frame them as depth or "cheap filler."
- Only recommend trades that a reasonable opposing owner would actually accept.

Provide:
**TEAM IDENTITY** — What type of contender/rebuilder/pretender is this? (2-3 sentences)
**CORE STRENGTHS** — What does this team do well? Name the specific players driving it
**CRITICAL WEAKNESSES** — Where are the real gaps? Be brutally honest
**DRAFT CAPITAL & FAAB** — Zero-pick years are a crisis. Pick-rich years are leverage. Assess accordingly and state what it means for their ability to add talent.
**TRADE OUTLOOK** — Buyer, seller, or holding? What should they target vs. deal away?
**TOP RECOMMENDED MOVES** — 2-3 specific, value-balanced trade ideas. For each: name the target, what to offer, why the other owner says yes.
${negotiationSection}`;
}

function buildPartnersPrompt(ctx: any): string {
    const partnersStr = ctx.partners.map((p: any, i: number) =>
        `${i + 1}. ${p.owner} (${p.record}) | Compat: ${p.compatibility}% | ${p.tier} | DNA: ${p.dna} | Posture: ${p.posture}
   Strengths: ${(p.strengths || []).join(', ')}
   Needs: ${(p.needs || []).join(', ')}${p.grudgeEntries > 0 ? ` | Trade history: ${p.grudgeEntries} logged interactions` : ''}`
    ).join('\n');

    return `I'm **${ctx.myTeam.owner}** looking for the best trading partners in ${ctx.leagueName}.

**MY TEAM:** ${ctx.myTeam.record} | ${ctx.myTeam.tier} | Health: ${ctx.myTeam.healthScore}/100 | Posture: ${ctx.myTeam.posture}
My Strengths: ${(ctx.myTeam.strengths || []).join(', ')}
My Needs: ${(ctx.myTeam.needs || []).join(', ')}

**ALL OWNERS (ranked by trade compatibility):**
${partnersStr}

Identify my top 3 trading partners and one sleeper pick:

**TRADE PARTNER #1: [NAME]**
- Why they're a great target
- What I should offer (my surplus fills their need)
- What I should target (their surplus fills my need)
- Negotiation strategy based on their DNA

**TRADE PARTNER #2: [NAME]**
[same format]

**TRADE PARTNER #3: [NAME]**
[same format]

**SLEEPER PICK** — One overlooked partner most would miss and exactly why`;
}

function buildFATargetsPrompt(ctx: any): string {
    const rosterStr = (ctx.myRoster || []).map((p: any) =>
        `  ${p.pos} ${p.name} (${p.team}) | ${p.pts ? `${p.pts}pts` : 'no stats'} | Yr ${p.yrsExp ?? '?'}${p.isStarter ? ' [STARTER]' : p.isTaxi ? ' [TAXI]' : ''}`
    ).join('\n');

    const faStr = (ctx.topFreeAgents || []).slice(0, 50).map((fa: any) =>
        `  ${fa.pos} ${fa.name} (${fa.team || 'FA'}) | ${fa.pts ? `${fa.pts}pts` : '—'} | ${fa.gp ? `${fa.gp}gp` : ''} | ${fa.avg ? `${fa.avg}avg` : ''} | Yr ${fa.yrsExp ?? '?'}${fa.isRookie ? ' [ROOKIE]' : ''}`
    ).join('\n');

    const rosterPositions = (ctx.rosterPositions || []).filter((p: string) => p !== 'BN' && p !== 'IR').join(', ');

    return `Build a free agency action plan for **${ctx.myOwner}** in **${ctx.leagueName}**.

**REMAINING FAAB:** $${ctx.faabBudget} of $${ctx.startingBudget}
**STARTING LINEUP SPOTS:** ${rosterPositions}

**MY CURRENT ROSTER:**
${rosterStr || 'No roster data'}

**TOP AVAILABLE FREE AGENTS:**
${faStr || 'No FA data'}

Provide:
**ROSTER AUDIT** — 2-3 sentences: current strengths and the biggest gaps to address
**TOP FA TARGETS** — 5-7 specific free agents I should pursue, each with:
  - Why they fit my roster (positional need, age profile, upside)
  - Suggested FAAB bid ($X–$Y range)
  - Priority tier (must-win bid / competitive / speculative)
**BUDGET STRATEGY** — How to allocate the $${ctx.faabBudget} remaining across positions
**WAIVER WIRE APPROACH** — Aggressive or patient? Any positional runs to expect?`;
}

function buildRookiesPrompt(ctx: any): string {
    const rosterStr = (ctx.myRoster || []).map((p: any) =>
        `  ${p.pos} ${p.name} | ${p.pts ? `${p.pts}pts` : 'no stats'} | Yr ${p.yrsExp ?? '?'}${p.isStarter ? ' [STARTER]' : p.isTaxi ? ' [TAXI]' : ''}`
    ).join('\n');

    const rookieStr = (ctx.availableRookies || []).map((r: any) =>
        `  ${r.pos} ${r.name} (${r.team})`
    ).join('\n');

    const rosterPositions = (ctx.rosterPositions || []).filter((p: string) => p !== 'BN' && p !== 'IR').join(', ');

    // Build draft pick summary from fully-resolved pick list (same logic as trade-calculator)
    const myPicks: any[] = ctx.myDraftPicks || [];
    const standardTotal: number = ctx.standardPickTotal || 21;
    const totalPicks = myPicks.length;

    let pickSummary: string;
    if (totalPicks === 0) {
        pickSummary = `⚠️ ZERO DRAFT PICKS — This owner has NO draft picks across any future season. They cannot participate in the rookie draft at all. Acquiring draft capital via trade must be the #1 priority.`;
    } else {
        const byYear: Record<string, number[]> = {};
        for (const p of myPicks) {
            const yr = String(p.year);
            if (!byYear[yr]) byYear[yr] = [];
            byYear[yr].push(p.round);
        }
        const pickLines = Object.entries(byYear)
            .sort(([a], [b]) => Number(a) - Number(b))
            .map(([yr, rounds]) => `  ${yr}: Rounds ${rounds.sort((a: number, b: number) => a - b).join(', ')}`)
            .join('\n');
        const deficit = standardTotal - totalPicks;
        const statusNote = deficit > 0
            ? `${totalPicks} of ${standardTotal} standard picks — ${deficit} picks below a full slate.`
            : totalPicks > standardTotal
            ? `${totalPicks} picks — ${totalPicks - standardTotal} above the ${standardTotal}-pick baseline (strong capital).`
            : `${totalPicks} picks — full standard slate.`;
        pickSummary = `${statusNote}\n${pickLines}`;
    }

    return `Provide a rookie draft strategy for **${ctx.myOwner}** in **${ctx.leagueName}**.

**STARTING LINEUP SPOTS:** ${rosterPositions}

**DRAFT PICK STATUS:**
${pickSummary}

**MY CURRENT ROSTER (with experience):**
${rosterStr || 'No roster data'}

**AVAILABLE ROOKIES (not on any roster):**
${rookieStr || 'No rookies available'}

CRITICAL INSTRUCTION: Base your entire strategy on the draft pick status above. If the owner has zero picks, do NOT recommend specific draft picks — instead focus your advice entirely on how to acquire picks via trade (what assets to offer, which roster positions to sell high on) and which rookies are worth targeting in trades post-draft.

Provide:
**DRAFT PICK SITUATION** — Clearly state how many picks this owner has and what it means for their draft strategy.
**ROSTER NEEDS ANALYSIS** — Which positions are thin, aging, or lack upside?
**STRATEGY** — If they have picks: BPA vs. positional need advice. If they have NO picks: specific trade strategies to acquire picks or post-draft rookie values to target.
**TARGET ROOKIES** — Top rookies that fit this team's needs (for drafting if picks exist, or for trade acquisition if not).
**SLEEPER PICKS** — 1-2 overlooked rookies worth targeting (via draft or trade).`;
}

function buildMockDraftPrompt(ctx: any): string {
    const isIDP = ctx.isIDP === true;

    const slotsStr = (ctx.draftSlots || []).map((o: any) => {
        let line = `Slot ${o.slot}: ${o.name} | Trade DNA: ${o.dna}`;
        if (o.draftDna)       line += ` | Draft Label: ${o.draftDna}`;
        if (o.roundProfile)   line += `\n         Round splits: ${o.roundProfile}`;
        else if (o.draftTendency) line += ` (${o.draftTendency})`;
        // Flag if they have unusually high early-round defensive picks
        if (o.earlyDefPct !== null && o.earlyDefPct > 10) {
            line += `\n         ⚠ Takes defenders in R1-R2 ${o.earlyDefPct}% of the time (NFL avg: 9%)`;
        }
        if (o.needs?.length)  line += `\n         Needs: ${o.needs.join(', ')}`;
        return line;
    }).join('\n');

    const playersStr = (ctx.players || []).map((p: any) =>
        `${p.fantasyRank}. ${p.name} | ${p.pos} | Tier ${p.tier}`
    ).join('\n');

    const draftTypeLabel = ctx.draftType === 'snake'
        ? 'SNAKE (odd rounds pick left→right, even rounds pick right→left)'
        : 'LINEAR (same slot order every round)';

    const idpNote = isIDP
        ? `• This IS an IDP (Individual Defensive Player) league — LB, DL, DB are valid picks at any round IF the owner has a confirmed Need for that position.`
        : `• This is a STANDARD fantasy league (NOT IDP). Defensive positions (LB, DL, DB, S, CB, EDGE) score ZERO fantasy points and are almost never drafted early.`;

    return `Simulate a complete ${ctx.numRounds}-round rookie draft with ${ctx.numTeams} teams in ${ctx.leagueName || 'the league'}.

DRAFT TYPE: ${draftTypeLabel}

OWNER PROFILES (slot → name → Trade DNA → Draft DNA from 3 seasons of real picks → round splits → needs):
${slotsStr}

DRAFT DNA LABELS (derived from real owner pick history):
• QB-Hunter   → Has taken QB in round 1 historically
• QB-Hungry   → >15% of picks are QB
• RB-Heavy    → >38% of picks are RB
• WR-First    → >38% of picks are WR
• TE-Premium  → >15% of picks are TE
• DEF-Early   → Unusually takes defenders in R1-R2 (rare — >20% of their early picks)
• QB-Avoider  → Never or rarely drafts QB before round 4
• Balanced    → No strong positional bias
The "Round splits" line shows what each owner ACTUALLY drafts by round group across 3 seasons.
When Draft DNA conflicts with current Needs, current Needs take priority for critical gaps (0 starters at a position).

AVAILABLE PLAYERS (fantasy-ranked — #1 = highest fantasy value, defenders already deprioritized):
Players are ordered by fantasy scoring potential, not NFL draft consensus.
QB/RB/WR float to the top; EDGE/LB/CB/S sink to the bottom of the pool.
Pick from this list in order — #1 is the top remaining fantasy asset:
${playersStr}

═══════════════════════════════════════════════════════
REAL NFL DRAFT BASELINE — ground your simulation here
═══════════════════════════════════════════════════════
Across 2023, 2024, and 2025 NFL drafts (96 picks in rounds 1-2):
  • Only 9 of 96 picks (9%) were defenders — all were Edge rushers or OLBs
  • ZERO CBs, safeties, LBs, or DTs were taken in rounds 1-2
  • Across all rounds: ~32% of picks are defenders — but concentrated heavily in rounds 4-7

Dynasty fantasy owners mirror this behavior. In a realistic dynasty rookie draft:
  Round 1: 90%+ skill positions (QB/RB/WR/TE). A defender in round 1 is extremely rare.
  Round 2: 90%+ skill positions. The occasional EDGE rusher only in IDP leagues.
  Round 3-5: Mostly skill positions, a few EDGE/OLB may appear.
  Round 6+: Defenders become more common — up to 30-40% of late picks.
${idpNote}

═══════════════════════════════════════════════════════
FANTASY FOOTBALL POSITIONAL SCORING RULES
═══════════════════════════════════════════════════════
Fantasy points come from OFFENSE only in standard leagues.

SCORING POSITIONS (target these):
  QB  — Scarce. A team without a QB starter MUST address early.
  RB  — Premium volume scorer. Top RBs are always R1-R2 value.
  WR  — Receiver depth needed. Strong R1-R4 value.
  TE  — Elite TEs are assets; depth TEs are round 5+ picks.

NON-SCORING IN STANDARD LEAGUES (almost never draft before round 6):
  EDGE, LB, CB, S, DL — contribute zero to fantasy scores. Only valid early in IDP leagues.

ROUND-BY-ROUND POSITIONAL RULES (strictly enforce):
  Round 1: QB / RB / WR only. No defenders. No exceptions in standard leagues.
  Round 2: QB / RB / WR / TE. No defenders. EDGE only if owner is flagged DEF-Early AND it's IDP.
  Round 3-4: Skill positions. EDGE/OLB may appear if owner's round splits show it.
  Round 5+: Any position is fair game, guided by owner's actual round-split profile.

CRITICAL: If an owner's "Round splits" show their R1-2 picks are 100% skill positions historically,
simulate them drafting 100% skill positions in rounds 1-2. Don't add defenders just to vary picks.

DNA DRAFT BEHAVIOR (apply AFTER positional rules above):
• Win Now       → Immediate contributors at QB/RB/WR who can start this season.
• Rebuilder     → Ceiling over floor. Raw upside at any OFFENSIVE position.
• Value Drafter → Strict BPA among offensive players. Trusts consensus rankings.
• Need Drafter  → Fills offensive roster gaps first. Reaches 3-5 spots for a critical need.
• Contrarian    → Takes offensive players ranked 8-15 spots below expectations.
• Risk Averse   → Safe college producers at skill positions. No boom-or-bust gambles.
• Aggressive    → Reaches 3-8 spots for high-upside offensive plays.
• Unknown       → Balanced BPA among offensive players with mild positional awareness.

CRITICAL SIMULATION RULES:
1. Each player can only be selected ONCE — track every pick and never repeat a player name
2. Process picks in the correct draft order based on DRAFT TYPE above
3. EVERY pick must reflect that specific owner's DNA and round-split profile
4. Round 1: ONLY QB, RB, or WR — no TE, no defenders, in a standard league
5. Round 2: QB, RB, WR, or TE only — still no defenders in standard leagues
6. Use each owner's "Round splits" data as the primary guide for when they take each position type
7. The "reason" field must be 10-15 words referencing DNA behavior, positional need, or roster fit
8. QB NEED IS ABSOLUTE: If an owner's Needs include QB, their FIRST pick IS the best available QB.
   No exceptions. No DNA override. No "BPA instead." Dynasty owners without a QB starter always
   take the first available QB — that is universally what every owner does in this situation.

Output ONLY a valid JSON array with no extra text, no markdown, no backticks:
[{"pick":1,"round":1,"slot":1,"owner":"Name","player":"Exact Player Name","pos":"WR","tier":1,"reason":"DNA-driven reason in exactly 10-15 words"},...]`;
}

function buildFAChatPrompt(ctx: any): string {
    const rosterStr = (ctx.myRoster || []).map((p: any) =>
        `  ${p.pos} ${p.name} (${p.team}) | ${p.pts ? `${p.pts}pts` : 'no stats'} | Yr ${p.yrsExp ?? '?'}${p.isStarter ? ' [STARTER]' : ''}`
    ).join('\n');

    const faStr = (ctx.topFreeAgents || []).slice(0, 30).map((fa: any) =>
        `  ${fa.pos} ${fa.name} (${fa.team || 'FA'}) | ${fa.pts ? `${fa.pts}pts` : '—'} | Yr ${fa.yrsExp ?? '?'}${fa.isRookie ? ' [ROOKIE]' : ''}`
    ).join('\n');

    return `You are advising **${ctx.myOwner}** on their free agency strategy in **${ctx.leagueName}**.

**REMAINING FAAB:** $${ctx.faabBudget} of $${ctx.startingBudget}

**MY ROSTER:**
${rosterStr || 'No roster data'}

**TOP AVAILABLE FREE AGENTS:**
${faStr || 'No FA data'}

**Question:** ${ctx.question}`;
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
    }

    try {
        const body = await req.json();
        const { type, context } = body;

        if (!type || !context) {
            return new Response(
                JSON.stringify({ error: 'Missing required fields: type, context' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
        if (!apiKey) {
            return new Response(
                JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const anthropic = new Anthropic({ apiKey });

        let userPrompt: string;
        switch (type) {
            case 'league':     userPrompt = buildLeaguePrompt(context);    break;
            case 'team':       userPrompt = buildTeamPrompt(context);      break;
            case 'partners':   userPrompt = buildPartnersPrompt(context);  break;
            case 'fa_targets': userPrompt = buildFATargetsPrompt(context); break;
            case 'rookies':    userPrompt = buildRookiesPrompt(context);   break;
            case 'fa_chat':    userPrompt = buildFAChatPrompt(context);    break;
            case 'mock_draft': userPrompt = buildMockDraftPrompt(context); break;
            default:
                return new Response(
                    JSON.stringify({ error: `Unknown analysis type: ${type}` }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
        }

        const isMockDraft = type === 'mock_draft';
        const message = await anthropic.messages.create({
            model: 'claude-haiku-4-5-20251001', // dev mode — switch to claude-sonnet-4-6 pre-launch
            max_tokens: isMockDraft ? 8000 : 1200,
            system: isMockDraft
                ? 'You are a dynasty fantasy football draft simulator. Output ONLY a raw JSON array. No markdown, no code fences, no backticks, no prose before or after. Start your response with [ and end with ]. Never repeat a player. Track all prior picks carefully so each player is selected at most once.'
                : buildSystemPrompt(),
            messages: [{ role: 'user', content: userPrompt }],
        });

        const analysis = (message.content[0] as any).text as string;

        // For mock_draft, parse the JSON picks array from the AI response
        let picks: any[] | undefined;
        if (isMockDraft) {
            // Strip markdown code fences if the AI wrapped the response despite instructions
            let cleanAnalysis = analysis.trim();
            if (cleanAnalysis.startsWith('```')) {
                cleanAnalysis = cleanAnalysis.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
            }
            try {
                picks = JSON.parse(cleanAnalysis);
            } catch {
                const match = cleanAnalysis.match(/\[[\s\S]*\]/);
                if (match) {
                    try { picks = JSON.parse(match[0]); } catch { /* leave undefined */ }
                }
            }
        }

        return new Response(
            JSON.stringify({ analysis, ...(picks ? { picks } : {}) }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    } catch (error: any) {
        console.error('[ai-analyze] error:', error);
        return new Response(
            JSON.stringify({ error: error.message || 'Internal server error' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
