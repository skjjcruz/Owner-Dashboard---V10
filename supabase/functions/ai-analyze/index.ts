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
    const rosterStr = (t.roster || []).map((p: any) =>
        `  ${p.pos} | ${p.name} (${p.team}) | Value: ${p.value}${p.isElite ? ' ★ELITE' : ''}`
    ).join('\n');

    return `Provide a comprehensive scouting report on **${t.owner}**'s team in ${ctx.leagueName}.

**TEAM OVERVIEW:** ${t.record} | ${t.tier} | Health: ${t.healthScore}/100 | ${t.weeklyPts} pts/wk | Posture: ${t.posture}
**OWNER DNA:** ${t.dna}${t.dnaDescription ? ` — ${t.dnaDescription}` : ''}
**STATED NEEDS:** ${(t.needs || []).join(', ') || 'none identified'}
**STATED STRENGTHS:** ${(t.strengths || []).join(', ') || 'none identified'}
**DRAFT CAPITAL:** ${t.picksText || 'No pick data available'}
**FAAB:** ${t.faabText || (t.waiverBudget > 0 ? `$${t.faabRemaining} of $${t.waiverBudget} remaining` : 'No FAAB system')}

**ROSTER (by position, sorted by value):**
${rosterStr || 'No roster data available'}

${ctx.myOwner ? `**I am:** ${ctx.myOwner}\n` : ''}

Provide:
**TEAM IDENTITY** — What type of contender/rebuilder/pretender is this? (2-3 sentences)
**CORE STRENGTHS** — What does this team do well? Name the specific players driving it
**CRITICAL WEAKNESSES** — Where are the real gaps? Be brutally honest
**DRAFT CAPITAL & FAAB** — Assess their pick inventory and budget. How does it shape their options?
**TRADE OUTLOOK** — Buyer, seller, or holding? What should they target vs. deal away?
**TOP RECOMMENDED MOVES** — 2-3 specific trade targets with what to offer
**NEGOTIATION PLAYBOOK** — Based on their ${t.dna} DNA profile, how would you approach dealing with this owner?`;
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
            model: 'claude-opus-4-6',
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
