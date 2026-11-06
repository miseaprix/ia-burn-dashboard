import {EnterpriseContext, DEFAULT_ENTERPRISE_LABEL, isEnterpriseEnabled, resolveSource} from './lib/enterprise.js';
import ContextCostPage from './components/ContextCostPage.jsx';
import {DEMO} from './lib/demo-mode.js';
import {apiFetch} from './lib/api.js';
import GatewayActivity from './components/GatewayActivity.jsx';
import ActivationPage from './components/ActivationPage.jsx';
import MonitoringPage from './components/MonitoringPage.jsx';
import React, { useEffect, useState } from 'react';
import useDashboard from './hooks/useDashboard.js';
import Header from './components/Header.jsx';
import HelpPage from './components/HelpPage.jsx';
import AdminPage from './components/AdminPage.jsx';
import BrandIcon from './components/BrandIcon.jsx';
import StatStrip from './components/StatStrip.jsx';
import DailySpendChart from './components/DailySpendChart.jsx';
import ByGroup from './components/ByGroup.jsx';
import ModelsTable from './components/ModelsTable.jsx';
import BudgetBurndown from './components/BudgetBurndown.jsx';
import AccountPanel from './components/AccountPanel.jsx';
import SurfaceChart from './components/SurfaceChart.jsx';
import TokenBreakdown from './components/TokenBreakdown.jsx';
import SubscriptionEconomics from './components/SubscriptionEconomics.jsx';
import Footer from './components/Footer.jsx';
import { fmtUsd, fmtSpend } from './lib/format.js';
const baseNames = { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode' };
const ranges = {
  today: 'Today',
  yesterday: 'Yesterday',
  rtd: 'Reset to date',
  wtd: 'Week to date',
  mtd: 'Month to date',
  week: 'Last 7 days',
  month: 'Last 30 days',
  ytd: 'Year to date',
  all: 'All time',
  custom: 'Custom dates',
};
export default function App() {
  const [label,setLabel]=useState(DEFAULT_ENTERPRISE_LABEL);
  const [enterpriseEnabled,setEnterpriseEnabled]=useState(true);
  useEffect(()=>{let active=true;apiFetch('/api/config').then(r=>r.ok ? r.json() : null).then(x=>{if(!active || !x)return;if(x.enterprise?.label)setLabel(x.enterprise.label);setEnterpriseEnabled(isEnterpriseEnabled(x));}).catch(()=>{});return()=>{active=false;};},[]);
  const names={...baseNames,enterprise:label};
  const params = new URLSearchParams(window.location.search);
  const [source, setSource] = useState(() => ['enterprise','local','enterprise-local'].includes(params.get('source')) ? params.get('source') : (DEMO ? 'enterprise' : 'local')),
    [range, setRange] = useState(() => ranges[params.get('range')] ? params.get('range') : (DEMO ? 'mtd' : 'all')),
    [selected, setSelected] = useState(()=>{const page=params.get('page');return page && /^[a-z0-9_-]+$/i.test(page) ? page : 'overview';}),
    [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 650);
  // Without a gateway URL, enterprise sources are hidden: fall back to the personal source.
  useEffect(()=>{const next=resolveSource(source,enterpriseEnabled);if(next!==source){setSelected('overview');setSource(next);}},[source,enterpriseEnabled]);
  const [integrations,setIntegrations]=useState(null);
  useEffect(()=>{let active=true;apiFetch('/api/integrations').then(r=>r.ok ? r.json() : null).then(x=>{if(active)setIntegrations(x);}).catch(()=>{});return()=>{active=false;};},[selected,source]);
  // Garder page, source et période dans l'URL : une actualisation reste sur la page active
  useEffect(()=>{const q=new URLSearchParams(window.location.search);q.set('page',selected);q.set('source',source);q.set('range',range);window.history.replaceState(null,'',`${window.location.pathname}?${q}${window.location.hash}`);},[selected,source,range]);
  const initialDay = new Date().toLocaleDateString('en-CA');
  const [from, setFrom] = useState(initialDay), [to, setTo] = useState(initialDay);
  const {data, error, loading, refresh: fetchData} = useDashboard({source, range, from, to});
  const changeSource = (value) => {
    setSelected('overview');
    setSource(value);
    if (value !== 'local' && range === 'rtd') setRange('mtd');
  };
  const current = data?.source === source ? data : null,
    caps = current?.capabilities || {
      tokens: false,
      groups: 'provider',
      budget: false,
    };
  const detail =
      selected === 'overview' ? null : current?.harnesses?.[selected],
    view = detail || current;
  const keys = source === 'enterprise-local' ? ['claude', 'codex', 'opencode'] : source === 'local' ? ['codex', 'claude'] : [];
  const quota = (h, key) =>
    key === 'codex'
      ? h?.burndown?.weekly?.remainingPercent
      : (h?.burndown?.weekly?.remainingPercent ??
        h?.burndown?.session?.remainingPercent);
  const personalReady=selected==='overview' ? Object.values(integrations?.personal?.observed || {}).some(Boolean) || Object.values(current?.harnesses || {}).some(h=>h?.burndown?.weekly || h?.burndown?.session) : integrations?.personal?.observed?.[selected] || detail?.burndown?.weekly || detail?.burndown?.session;
  const localReady=selected==='overview' ? Object.values(integrations?.corporateLocal?.observed || {}).some(Boolean) : integrations?.corporateLocal?.observed?.[selected];
  const activation=integrations && !['admin','help','monitoring','context'].includes(selected) ? source==='enterprise' && !integrations.corporate.configured ? 'corporate' : source==='local' && !personalReady ? 'personal' : source==='enterprise-local' && !localReady ? 'local' : null : null;
  const headerQuota =
    selected === 'overview'
      ? quota(current?.harnesses?.claude)
      : quota(detail, selected);
  return (
    <EnterpriseContext.Provider value={label}>
    <div className={`app ${sidebarOpen ? '' : 'sidebar-hidden'}`}>
      <aside className="sidebar" aria-label="Dashboard views">
        <div className="sidebar-brand">
          <BrandIcon />
          <strong>IA Burn</strong>
          <button
            className="icon-button"
            onClick={() => setSidebarOpen(false)}
            aria-label="Collapse sidebar"
          >
            ☷
          </button>
        </div>
        <nav>
          <button
            className={`sidebar-item ${selected === 'overview' ? 'active' : ''}`}
            onClick={() => setSelected('overview')}
            aria-current={selected === 'overview' ? 'page' : undefined}
          >
            <BrandIcon />
            <strong>{source === 'enterprise' ? `${label}` : 'Overview'}</strong>
            <span className="sidebar-total">
              {current && !activation ? fmtSpend(current.totals) : '—'}
            </span>
          </button>
          {keys.length > 0 && <p className="sidebar-section">
            {source === 'enterprise-local' ? `${label} harnesses` : source === 'local' ? 'Subscriptions' : 'Corporate'}
          </p>}
          {keys.map((k) => {
            const remaining = quota(current?.harnesses?.[k], k);
            return (
              <button
                key={k}
                className={`sidebar-item ${selected === k ? 'active' : ''}`}
                onClick={() => setSelected(k)}
                aria-current={selected === k ? 'page' : undefined}
              >
                <BrandIcon name={k} />
                <strong>{names[k]}</strong>
                {remaining != null && (
                  <span className={`quota-pill ${remaining < 15 ? 'bad' : ''}`}>
                    {remaining.toFixed(0)}%
                  </span>
                )}
              </button>
            );
          })}
          <p className="sidebar-section">Métriques étendues</p>
          <button className={`sidebar-item ${selected==='monitoring' ? 'active' : ''}`} onClick={()=>setSelected('monitoring')} aria-current={selected==='monitoring' ? 'page' : undefined}><span className="help-nav-icon" aria-hidden="true">↗</span><strong>Monitoring</strong><span className="integration-nav-level">3</span></button>
        </nav>
        <div className="sidebar-help">
          <button className={`sidebar-item ${selected==='context' ? 'active':''}`} onClick={()=>setSelected('context')} aria-current={selected==='context' ? 'page':undefined}><span className="help-nav-icon" aria-hidden="true">◫</span><strong>Contexte et coût</strong></button>
          <button className={`sidebar-item ${selected === 'admin' ? 'active' : ''}`} onClick={() => setSelected('admin')} aria-current={selected === 'admin' ? 'page' : undefined}>
            <span className="help-nav-icon" aria-hidden="true">⚙</span><strong>Admin</strong>
          </button>
          <p className="sidebar-section">Documentation</p>
          <button className={`sidebar-item ${selected === 'help' ? 'active' : ''}`}
            onClick={() => setSelected('help')} aria-current={selected === 'help' ? 'page' : undefined}>
            <span className="help-nav-icon" aria-hidden="true">?</span><strong>Help</strong>
          </button>
        </div>
      </aside>
      <div className="workspace">
        {DEMO && <div className="demo-banner" role="region" aria-label="Démonstration">
          <div><strong>Démonstration · consommation fictive</strong><span>Contexte et matrice : références {label} datées. Autres métriques : exemples fictifs. Aucun appel payant ni accès à vos comptes.</span></div>
          {selected!=='context' && <button type="button" className="activation-secondary" onClick={()=>setSelected('context')}>Simuler le coût du cache →</button>}
          <label>Scénario <select aria-label="Niveau de démonstration" value={new URLSearchParams(window.location.search).get('level') || '3'} onChange={e=>{const u=new URL(window.location.href);u.searchParams.set('level',e.target.value);window.location.assign(u.href);}}>
            {enterpriseEnabled && <option value="1">Niveau 1 · {label}</option>}<option value="2">Niveau 2 · Perso</option><option value="3">Niveau 3 · Toutes les fonctionnalités</option>
          </select></label>
        </div>}
        {['help','admin','monitoring','context'].includes(selected) ? (
          <header className="header">
            <div className="toolbar-title">
              <button className="icon-button" aria-label="Toggle sidebar" onClick={() => setSidebarOpen(v => !v)}>☷</button>
              <div><h1>{selected === 'context' ? 'Contexte et coût' : selected === 'admin' ? 'Admin' : selected==='monitoring' ? 'Monitoring' : 'Help'}</h1><p>{selected === 'context' ? 'Simulation pédagogique · contexte, cache et effort' : selected === 'admin' ? 'Configuration de l’application' : selected==='monitoring' ? 'Niveau 3 · Activité et contexte' : 'Sources de données et harnais'}</p></div>
            </div>
            <button className="help-back" onClick={() => setSelected('overview')}>Retour au dashboard</button>
          </header>
        ) : <Header
          title={selected === 'overview' ? source === 'enterprise' ? `${label}` : 'Overview' : names[selected]}
          source={source}
          enterpriseEnabled={enterpriseEnabled}
          onSourceChange={changeSource}
          range={range}
          onRangeChange={setRange}
          rangeLabel={range === 'custom' ? `${from} – ${to}` : ranges[range]}
          from={from} to={to} onFromChange={setFrom} onToChange={setTo}
          today={current?.refresh?.today || initialDay}
          quota={headerQuota}
          onRefresh={fetchData}
          loading={loading}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
        />}
        <main className="dashboard-content">
          {selected === 'context' && <ContextCostPage onAdmin={()=>setSelected('admin')}/> }
          {selected === 'help' && <HelpPage />}
          {selected === 'admin' && <AdminPage integrations={integrations} enterpriseEnabled={enterpriseEnabled} onHelp={()=>setSelected('help')} />}
          {selected==='monitoring' && <MonitoringPage integration={integrations?.monitoring} onAdmin={()=>setSelected('admin')} onHelp={()=>setSelected('help')}/>}
          {activation && !loading && <ActivationPage kind={activation} name={names[selected]} waiting={activation==='personal' && (selected==='overview' ? Object.values(integrations.personal.configured).some(Boolean) : integrations.personal.configured[selected])} onAdmin={()=>setSelected('admin')} onHelp={()=>setSelected('help')}/>}
          {!['help','admin','monitoring','context'].includes(selected) && !activation && error && (
            <div className="error-banner">
              <strong>{current ? 'Refresh failed; showing previous metrics.' : 'Could not load data.'}</strong> {error}
            </div>
          )}
          {!['help','admin','monitoring','context'].includes(selected) && loading && !current && <div className="loading">Loading…</div>}
          {!['help','admin','monitoring','context'].includes(selected) && !activation && view && (
            <>
              {(current.warnings || []).map((w) => (
                <div key={w} className="error-banner">
                  {w}
                </div>
              ))}
              {source === 'enterprise' &&
                current.budget &&
                current.budgetBurndown && (
                  <BudgetBurndown
                    budget={current.budget}
                    burndown={current.budgetBurndown}
                  />
                )}
              {detail?.subscription && (
                <AccountPanel key={`account-${source}-${selected}`} harness={selected} data={detail} />
              )}
              {source === 'local' && selected === 'codex' && current.refresh?.includesToday && (
                <SurfaceChart data={detail?.surfaceBreakdown} status={detail?.surfaceStatus} />
              )}
              <StatStrip
                totals={view.totals}
                gateway={source === 'enterprise'}
                capabilities={caps}
                periodLabel={ranges[range]}
                harnessName={
                  detail
                    ? names[selected]
                    : source !== 'enterprise'
                      ? 'Across all harnesses'
                      : 'Available source data'
                }
              />
              {source === 'enterprise' && <GatewayActivity totals={view.totals} daily={view.daily} />}
              <div
                className={`spend-layout ${selected === 'overview' ? 'overview-spend' : ''}`}
              >
                <DailySpendChart
                  key={`${source}-${selected}`}
                  daily={view.daily}
                  models={source === 'enterprise' ? view.models : undefined}
                  groups={view.groups}
                  capabilities={caps}
                  defaultMode={current.granularityDefault}
                  period={current.requested}
                />
                {selected === 'overview' && (
                  <ByGroup
                    groups={view.groups}
                    capabilities={caps}
                    onSelect={source !== 'enterprise' ? setSelected : null}
                  />
                )}
              </div>
              <ModelsTable
                key={`${source}-${selected}`}
                models={view.models}
                capabilities={caps}
              />
              {selected === 'overview' && current.subscriptions?.length > 0 && (
                <section className="card subscriptions-panel">
                  <div className="chart-head">
                    <h2 className="card-title">
                      <BrandIcon name="subscriptions" />
                      Subscriptions
                    </h2>
                    <span className="chart-unit">Monthly plan prices</span>
                  </div>
                  <div className="subscription-grid">
                    {current.subscriptions.map((s) => (
                      <button
                        key={s.harness}
                        className="subscription-row"
                        onClick={() => setSelected(s.harness)}
                      >
                        <BrandIcon name={s.harness} size={22} />
                        <span>
                          <strong>{names[s.harness]}</strong>
                          <small>{s.plan}</small>
                        </span>
                        <b>
                          {s.pricePerMonth == null
                            ? '—'
                            : fmtUsd(s.pricePerMonth)}
                          <small>/mo</small>
                        </b>
                      </button>
                    ))}
                  </div>
                </section>
              )}
              {detail?.tokenBreakdown && <TokenBreakdown data={detail.tokenBreakdown} />}
              {detail?.economics && <SubscriptionEconomics key={`economics-${source}-${selected}`} data={detail} harness={selected} />}
              <Footer footnote={current.footnote} period={current.requested} />
            </>
          )}
        </main>
        <div className="status-bar">
          <span>
            <i className={`freshness-dot ${error || current?.collection?.usage?.error ? 'stale' : ''}`} />
            {loading
              ? 'Refreshing…'
              : current
                ? current.collection?.usage?.lastSuccess
                  ? `Collected ${new Date(current.collection.usage.lastSuccess).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })} · ${current.refresh?.includesToday ? 'Live' : 'Historical'}`
                  : 'Waiting for first collection'
                : 'Waiting for data'}
          </span>
          <span>
            IA Burn ·{' '}
            {source === 'enterprise-local' ? `${label} local usage` : source === 'local' ? 'Personal usage' : 'Corporate budget'}
          </span>
        </div>
      </div>
    </div>
    </EnterpriseContext.Provider>
  );
}
