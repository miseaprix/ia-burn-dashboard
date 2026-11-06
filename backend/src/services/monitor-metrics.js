// Read-only usage counters from persisted metadata. Tool lifecycle pairs share
// one invocation key; events without such a key are reported separately.
export function monitorMetrics(db, where='', args=[]) {
  const base=`WITH selected AS (SELECT e.source,e.session_id,e.id,e.timestamp,e.payload FROM monitor_events e
    JOIN monitor_sessions s ON s.source=e.source AND s.id=e.session_id ${where})`;
  const toolTypes="json_extract(payload,'$.type') IN ('PreToolUse','PostToolUse','PostToolUseFailure')";
  const calls=`${base}, calls AS (SELECT source,session_id,json_extract(payload,'$.toolUseId') AS callId,
    MAX(json_extract(payload,'$.tool')) AS tool,MAX(json_extract(payload,'$.mcpServer')) AS mcpServer,
    MAX(json_extract(payload,'$.mcpTool')) AS mcpTool,MAX(json_extract(payload,'$.cli')) AS cli,
    MAX(json_extract(payload,'$.command')) AS command,MAX(json_extract(payload,'$.script')) AS script,
    MAX(json_extract(payload,'$.skill')) AS skill,MAX(json_extract(payload,'$.workflow')) AS workflow,
    MAX(CASE WHEN json_extract(payload,'$.type') IN ('PostToolUse','PostToolUseFailure') THEN 1 ELSE 0 END) AS completed,
    MAX(CASE WHEN json_extract(payload,'$.isError')=1 OR json_extract(payload,'$.type')='PostToolUseFailure' OR json_extract(payload,'$.exitCode')!=0 THEN 1 ELSE 0 END) AS failed
    FROM selected WHERE ${toolTypes} AND json_extract(payload,'$.toolUseId') IS NOT NULL
    GROUP BY source,session_id,callId)`;
  const result={};
  for (const [key,field] of Object.entries({tools:'tool',mcp:'mcpTool',cli:'cli',commands:'command',scripts:'script',skills:'skill',workflows:'workflow'})) {
    const name=key==='mcp' ? "COALESCE(mcpServer,'unknown')||' / '||mcpTool" : field;
    result[key]=db.prepare(`${calls} SELECT ${name} AS name,COUNT(*) AS calls,SUM(completed) AS completed,SUM(failed) AS failed
      FROM calls WHERE ${field} IS NOT NULL GROUP BY name ORDER BY calls DESC,name`).all(...args);
  }
  result.events=db.prepare(`${base} SELECT json_extract(payload,'$.type') AS name,COUNT(*) AS events
    FROM selected GROUP BY name ORDER BY events DESC,name`).all(...args);
  result.agents=db.prepare(`${base} SELECT COALESCE(json_extract(payload,'$.agent'),'unknown') AS name,
    COUNT(DISTINCT CASE WHEN json_extract(payload,'$.type')='SubagentStart' THEN
      CASE WHEN json_extract(payload,'$.agentId') IS NOT NULL OR json_extract(payload,'$.parentToolUseId') IS NOT NULL THEN
        source||char(0)||session_id||char(0)||COALESCE(json_extract(payload,'$.agentId'),json_extract(payload,'$.parentToolUseId')) END END) AS starts,
    SUM(CASE WHEN json_extract(payload,'$.type')='SubagentStop' THEN 1 ELSE 0 END) AS stopEvents
    FROM selected WHERE json_extract(payload,'$.type') IN ('SubagentStart','SubagentStop') GROUP BY name ORDER BY starts DESC,name`).all(...args);
  result.workflowRuns=db.prepare(`${base} SELECT COALESCE(json_extract(payload,'$.workflow'),'unknown') AS name,
    COUNT(DISTINCT source||char(0)||json_extract(payload,'$.workflowRunId')) AS runs
    FROM selected WHERE json_extract(payload,'$.workflowRunId') IS NOT NULL GROUP BY name ORDER BY runs DESC,name`).all(...args);
  result.coverage=db.prepare(`${base} SELECT
    SUM(CASE WHEN ${toolTypes} AND json_extract(payload,'$.toolUseId') IS NULL THEN 1 ELSE 0 END) AS unpairedToolEvents,
    SUM(CASE WHEN json_extract(payload,'$.type')='SubagentStart' AND json_extract(payload,'$.agentId') IS NULL AND json_extract(payload,'$.parentToolUseId') IS NULL THEN 1 ELSE 0 END) AS unidentifiedAgentStarts,
    SUM(CASE WHEN ${toolTypes} AND json_extract(payload,'$.tool')='Bash' AND json_extract(payload,'$.command') IS NULL THEN 1 ELSE 0 END) AS unidentifiedCommandEvents
    FROM selected`).get(...args);
  return result;
}
