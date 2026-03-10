// ============================================================
// Owner Dashboard — AI Analysis Edge Function
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
  Needs: ${(t.needs || []).join(', ') || 'none'}`;
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

**ROSTER (by position, sorted by value):**
${rosterStr || 'No roster data available'}

${ctx.myOwner ? `**I am:** ${ctx.myOwner}\n` : ''}

Provide:
**TEAM IDENTITY** — What type of contender/rebuilder/pretender is this? (2-3 sentences)
**CORE STRENGTHS** — What does this team do well? Name the specific players driving it
**CRITICAL WEAKNESSES** — Where are the real gaps? Be brutally honest
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

function buildChatPrompt(ctx: any): string {
    const teamsStr = (ctx.teams || []).map((t: any) =>
        `• ${t.owner} (${t.record}) | ${t.tier} | DNA: ${t.dna} | Needs: ${(t.needs || []).join(', ')} | Strengths: ${(t.strengths || []).join(', ')}`
    ).join('\n');

    return `You have full access to this dynasty league's data.

**League:** ${ctx.leagueName}
**My team:** ${ctx.myOwner || 'unknown'}

**TEAM SUMMARY:**
${teamsStr}

**My question:** ${ctx.question}`;
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
            case 'league':   userPrompt = buildLeaguePrompt(context);   break;
            case 'team':     userPrompt = buildTeamPrompt(context);     break;
            case 'partners': userPrompt = buildPartnersPrompt(context); break;
            case 'chat':     userPrompt = buildChatPrompt(context);     break;
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
