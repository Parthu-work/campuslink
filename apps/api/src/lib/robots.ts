/**
 * robots.txt per RFC 9309: groups by user-agent, longest-match wins between Allow and Disallow,
 * `*` and `$` wildcards. Fetch outcomes: 2xx parsed; 4xx (except 429) means no restrictions;
 * 5xx, 429 or unreachable means "assume disallowed" for now.
 */
interface Rule {
  allow: boolean;
  pattern: string;
}
export interface Robots {
  groups: { agents: string[]; rules: Rule[] }[];
}

export function parseRobots(text: string): Robots {
  const groups: Robots['groups'] = [];
  let current: { agents: string[]; rules: Rule[] } | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/).slice(0, 2000)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = (m[1] ?? '').toLowerCase();
    const value = (m[2] ?? '').trim();
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === 'allow' || key === 'disallow') {
      if (key === 'disallow' && value === '') continue; // empty Disallow = allow all
      current.rules.push({ allow: key === 'allow', pattern: value });
    }
  }
  return { groups };
}

function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = new RegExp(
    `^${body
      .split('*')
      .map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')}${anchored ? '$' : ''}`,
  );
  return re.test(path);
}

/** Is `path` (with query) allowed for this user agent token? */
export function robotsAllows(robots: Robots, agentToken: string, path: string): boolean {
  const token = agentToken.toLowerCase();
  const own = robots.groups.filter((g) => g.agents.some((a) => a !== '*' && token.includes(a)));
  const rules = (own.length ? own : robots.groups.filter((g) => g.agents.includes('*'))).flatMap(
    (g) => g.rules,
  );
  let best: Rule | null = null;
  for (const r of rules) {
    if (!matches(r.pattern, path)) continue;
    if (
      !best ||
      r.pattern.length > best.pattern.length ||
      (r.pattern.length === best.pattern.length && r.allow)
    )
      best = r;
  }
  return best ? best.allow : true;
}
