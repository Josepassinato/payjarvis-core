/**
 * Commerce Service: Sports Scores (ESPN Public API)
 *
 * Auth: None (completely free, no API key required)
 * Base: https://site.api.espn.com/apis/site/v2/sports
 */

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports";

// ─── Interfaces ──────────────────────────────────────

export interface SportsParams {
  sport?: string;   // football, basketball, baseball, hockey, soccer
  league?: string;  // nfl, nba, mlb, nhl, mls, eng.1 (Premier League)
  team?: string;    // team name filter
  limit?: number;
}

export interface GameScore {
  id: string;
  name: string;
  shortName: string;
  date: string;
  status: string;        // "pre" | "in" | "post"
  statusDetail: string;  // "Final", "3rd Quarter", "7:30 PM ET"
  homeTeam: string;
  homeScore: string;
  homeLogo: string;
  awayTeam: string;
  awayScore: string;
  awayLogo: string;
  venue: string;
  broadcast: string;
  headline?: string;
}

export interface StandingsEntry {
  team: string;
  wins: number;
  losses: number;
  ties?: number;
  winPct: string;
  streak: string;
  logo: string;
}

// ─── Sport/League mapping ────────────────────────────

const SPORT_MAP: Record<string, { sport: string; league: string }> = {
  nfl: { sport: "football", league: "nfl" },
  nba: { sport: "basketball", league: "nba" },
  mlb: { sport: "baseball", league: "mlb" },
  nhl: { sport: "hockey", league: "nhl" },
  mls: { sport: "soccer", league: "usa.1" },
  "premier league": { sport: "soccer", league: "eng.1" },
  "champions league": { sport: "soccer", league: "uefa.champions" },
  "la liga": { sport: "soccer", league: "esp.1" },
  serie_a: { sport: "soccer", league: "ita.1" },
  brasileirao: { sport: "soccer", league: "bra.1" },
  ncaaf: { sport: "football", league: "college-football" },
  ncaab: { sport: "basketball", league: "mens-college-basketball" },
  wnba: { sport: "basketball", league: "wnba" },
};

function resolveLeague(sport?: string, league?: string): { sport: string; league: string } {
  const key = (league || sport || "nfl").toLowerCase().replace(/\s+/g, " ");
  if (SPORT_MAP[key]) return SPORT_MAP[key];

  // Try to match partial
  for (const [k, v] of Object.entries(SPORT_MAP)) {
    if (key.includes(k) || k.includes(key)) return v;
  }

  // Default fallback
  if (sport) {
    const s = sport.toLowerCase();
    if (s.includes("football") || s.includes("futebol")) return SPORT_MAP.nfl;
    if (s.includes("basket")) return SPORT_MAP.nba;
    if (s.includes("baseball")) return SPORT_MAP.mlb;
    if (s.includes("hockey")) return SPORT_MAP.nhl;
    if (s.includes("soccer")) return SPORT_MAP.mls;
  }

  return SPORT_MAP.nfl;
}

// ─── Get Scores ──────────────────────────────────────

export async function getScores(params: SportsParams): Promise<{
  source: string;
  mock: boolean;
  sport: string;
  league: string;
  results: GameScore[];
  error?: string;
}> {
  const resolved = resolveLeague(params.sport, params.league);

  try {
    const url = `${ESPN_BASE}/${resolved.sport}/${resolved.league}/scoreboard`;
    const res = await fetch(url);
    if (!res.ok) {
      return { source: "espn", mock: false, sport: resolved.sport, league: resolved.league, results: [], error: `ESPN API error: ${res.status}` };
    }

    const data = await res.json() as any;
    const events = data.events || [];

    let results: GameScore[] = events.map((evt: any) => {
      const comp = evt.competitions?.[0];
      const home = comp?.competitors?.find((c: any) => c.homeAway === "home");
      const away = comp?.competitors?.find((c: any) => c.homeAway === "away");

      return {
        id: evt.id,
        name: evt.name || "",
        shortName: evt.shortName || "",
        date: evt.date || "",
        status: comp?.status?.type?.state || "pre",
        statusDetail: comp?.status?.type?.shortDetail || comp?.status?.type?.detail || "",
        homeTeam: home?.team?.displayName || home?.team?.name || "TBD",
        homeScore: home?.score || "0",
        homeLogo: home?.team?.logo || "",
        awayTeam: away?.team?.displayName || away?.team?.name || "TBD",
        awayScore: away?.score || "0",
        awayLogo: away?.team?.logo || "",
        venue: comp?.venue?.fullName || "",
        broadcast: comp?.broadcasts?.[0]?.names?.[0] || "",
        headline: evt.competitions?.[0]?.headlines?.[0]?.shortLinkText || undefined,
      };
    });

    // Filter by team if specified
    if (params.team) {
      const teamLower = params.team.toLowerCase();
      results = results.filter(g =>
        g.homeTeam.toLowerCase().includes(teamLower) ||
        g.awayTeam.toLowerCase().includes(teamLower)
      );
    }

    if (params.limit) {
      results = results.slice(0, params.limit);
    }

    return { source: "espn", mock: false, sport: resolved.sport, league: resolved.league, results };
  } catch (err: any) {
    return { source: "espn", mock: false, sport: resolved.sport, league: resolved.league, results: [], error: `ESPN fetch failed: ${err.message}` };
  }
}

// ─── Get Standings ───────────────────────────────────

export async function getStandings(params: SportsParams): Promise<{
  source: string;
  groups: { name: string; entries: StandingsEntry[] }[];
  error?: string;
}> {
  const resolved = resolveLeague(params.sport, params.league);

  try {
    const url = `${ESPN_BASE}/${resolved.sport}/${resolved.league}/standings`;
    const res = await fetch(url);
    if (!res.ok) {
      return { source: "espn", groups: [], error: `ESPN API error: ${res.status}` };
    }

    const data = await res.json() as any;
    const children = data.children || [];

    const groups = children.map((group: any) => {
      const entries: StandingsEntry[] = (group.standings?.entries || []).map((entry: any) => {
        const stats = entry.stats || [];
        const getStat = (name: string) => stats.find((s: any) => s.name === name)?.value ?? 0;

        return {
          team: entry.team?.displayName || entry.team?.name || "Unknown",
          wins: getStat("wins"),
          losses: getStat("losses"),
          ties: getStat("ties") || undefined,
          winPct: getStat("winPercent")?.toFixed(3) || ".000",
          streak: getStat("streak")?.toString() || "-",
          logo: entry.team?.logos?.[0]?.href || "",
        };
      });

      return { name: group.name || group.abbreviation || "Division", entries };
    });

    return { source: "espn", groups };
  } catch (err: any) {
    return { source: "espn", groups: [], error: `Standings fetch failed: ${err.message}` };
  }
}

// ─── Format for Telegram ─────────────────────────────

export function formatScoresResult(results: GameScore[], league: string): string {
  if (results.length === 0) return `No ${league.toUpperCase()} games found.`;

  const lines: string[] = [`${league.toUpperCase()} Scores:`];

  for (const g of results.slice(0, 10)) {
    if (g.status === "post") {
      lines.push(`${g.awayTeam} ${g.awayScore} @ ${g.homeTeam} ${g.homeScore} (Final)`);
    } else if (g.status === "in") {
      lines.push(`${g.awayTeam} ${g.awayScore} @ ${g.homeTeam} ${g.homeScore} (${g.statusDetail})`);
    } else {
      lines.push(`${g.awayTeam} @ ${g.homeTeam} — ${g.statusDetail}${g.broadcast ? ` (${g.broadcast})` : ""}`);
    }
  }

  return lines.join("\n");
}
