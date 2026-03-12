// ============================================================
// Owner Dashboard — AI Analysis Edge Function  [v2]
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
            default:
                return new Response(
                    JSON.stringify({ error: `Unknown analysis type: ${type}` }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
        }

        const message = await anthropic.messages.create({
            model: 'claude-haiku-4-5-20251001', // dev mode — switch to claude-sonnet-4-6 pre-launch
            max_tokens: 1200,
            system: buildSystemPrompt(),
            messages: [{ role: 'user', content: userPrompt }],
        });

        const analysis = (message.content[0] as any).text as string;

        return new Response(
            JSON.stringify({ analysis }),
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
