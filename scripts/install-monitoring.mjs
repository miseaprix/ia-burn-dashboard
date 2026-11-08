#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { installClaudeMonitor, stableNodePath } from './install-claude-monitor.mjs';

const label = 'local.ia-burn.model-collector';
const root = fileURLToPath(new URL('..', import.meta.url));
const logColors = { Aperçu: 36, Modifie: 33, OK: 32, Erreur: 31 };

function log(status, message, stream = process.stdout) {
  const tag = `[${status}]`;
  const prefix = stream.isTTY && !Object.hasOwn(process.env, 'NO_COLOR')
    ? `\x1b[${logColors[status]}m${tag}\x1b[0m` : tag;
  stream.write(`${prefix} ${message}\n`);
}

function readFile(file) {
  try {
    if (!lstatSync(file).isFile()) throw new Error(`Fichier ordinaire attendu pour ${file}`);
    return readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function parseConfig(contents, file) {
  try {
    const config = JSON.parse(contents ?? '{}');
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error();
    return config;
  } catch {
    throw new Error(`Objet JSON invalide dans ${file}`);
  }
}

function updateFile(file, before, after) {
  if (before === after) {
    log('OK', `Déjà à jour · ${file}`);
    return false;
  }
  if (readFile(file) !== before) throw new Error('Le fichier a changé pendant la préparation.');
  log('Modifie', `${before === null ? 'Création' : 'Mise à jour'} · ${file}`);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  if (before !== null) {
    const backup = file + '.burn-backup-' + randomUUID();
    writeFileSync(backup, before, { mode: 0o600, flag: 'wx' });
    log('OK', `Sauvegarde · ${backup}`);
  }
  const temporary = file + '.burn-' + randomUUID() + '.tmp';
  writeFileSync(temporary, after, { mode: 0o600, flag: 'wx' });
  try {
    if (readFile(file) !== before) throw new Error('Le fichier a changé pendant l’installation.');
    renameSync(temporary, file);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
  return true;
}

function addSource(config, key, directory, dataset) {
  const sources = config[key] ??= [];
  const source = sources.find(item => path.resolve(item.directory) === directory);
  if (source && source.dataset !== dataset) throw new Error(`La source ${key} utilise déjà un autre dataset.`);
  if (!source) sources.push({ directory, dataset });
}

function profilePaths(options, harness, filename, defaultDirectory) {
  const folders = options[`${harness}-profile`] ?? [];
  const paths = folders.map(directory => path.resolve(directory, filename));
  if (options[harness]) paths.push(path.join(defaultDirectory, filename));
  return [...new Set(paths)];
}

function run(options) {
  if (process.platform !== 'darwin') throw new Error('Cet installateur de service utilise launchd sur macOS.');
  if (process.getuid() === 0) throw new Error('Lancez la commande avec votre compte utilisateur.');
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node.js 24 ou plus récent est requis.');

  const home = homedir();
  const stateDir = path.join(home, '.local/state/ia-burn');
  const configPath = path.join(stateDir, 'collector.json');
  const plistPath = path.join(home, 'Library/LaunchAgents', label + '.plist');
  const envPath = path.join(root, '.env');
  const previousConfig = readFile(configPath);
  const config = parseConfig(previousConfig, configPath);
  const originalConfig = JSON.stringify(config);
  const existingReceiver = config.receiver ? new URL(config.receiver) : null;
  if (existingReceiver && (existingReceiver.protocol !== 'http:' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(existingReceiver.hostname) ||
    existingReceiver.pathname !== '/api/monitor/model-requests' ||
    existingReceiver.username || existingReceiver.password || existingReceiver.search || existingReceiver.hash)) {
    throw new Error('Le récepteur doit être une adresse HTTP locale.');
  }
  const port = options.port ?? (existingReceiver ? existingReceiver.port || '80' : '4095');
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('Le port doit être compris entre 1 et 65535.');
  const origin = `http://localhost:${Number(port)}`;
  if (options.port || !existingReceiver) config.receiver = `${origin}/api/monitor/model-requests`;
  config.since ??= new Date().toISOString();
  if (!Number.isFinite(Date.parse(config.since))) throw new Error('Renseignez une date since valide dans collector.json.');

  const dataset = options.dataset;
  if (!['personal', 'enterprise'].includes(dataset)) throw new Error('Le dataset doit être personal ou enterprise.');
  const suffix = dataset === 'enterprise' ? '-enterprise' : '';
  const profiles = [];
  const captureDirectories = new Set();
  const claudeProfiles = profilePaths(options, 'claude', 'settings.json', path.join(home, `.claude${suffix}`));
  for (const settingsFile of claudeProfiles) {
    const claudeRoot = path.dirname(settingsFile);
    const settings = parseConfig(readFile(settingsFile), settingsFile);
    const configuredCapture = settings.env?.OTEL_LOG_RAW_API_BODIES;
    if (configuredCapture !== undefined && (typeof configuredCapture !== 'string' || !configuredCapture.startsWith('file:/'))) {
      throw new Error('Le profil Claude utilise déjà une autre destination de capture.');
    }
    const defaultCapture = claudeRoot === path.join(home, `.claude${suffix}`)
      ? `direct${suffix}` : `profile-${createHash('sha256').update(claudeRoot).digest('hex').slice(0, 16)}`;
    const claudeCapture = path.resolve(configuredCapture ? configuredCapture.slice(5) : path.join(stateDir, 'claude-capture', defaultCapture));
    if (claudeCapture === '/' || (existsSync(claudeCapture) && !isPrivateDirectory(claudeCapture))) {
      throw new Error('La capture Claude doit utiliser un dossier privé appartenant à votre compte.');
    }
    addSource(config, 'claudeLogs', claudeRoot, dataset);
    addSource(config, 'claudeCaptures', claudeCapture, dataset);
    captureDirectories.add(claudeCapture);
    profiles.push({ dataset, settingsFile, captureEnv: {
      CLAUDE_CODE_ENABLE_TELEMETRY: '1',
      OTEL_LOGS_EXPORTER: 'console',
      OTEL_LOG_RAW_API_BODIES: configuredCapture ?? `file:${claudeCapture}`,
    } });
  }
  const codexProfiles = profilePaths(options, 'codex', 'hooks.json', path.join(home, `.codex${suffix}`));
  for (const settingsFile of codexProfiles) {
    parseConfig(readFile(settingsFile), settingsFile);
    addSource(config, 'codexLogs', path.dirname(settingsFile), dataset);
    profiles.push({ dataset, settingsFile, harness: 'codex' });
  }
  if (!config.claudeLogs?.length && !config.claudeCaptures?.length && !config.codexLogs?.length &&
    !config.openCodeDb && !config.openCodeCapture) {
    throw new Error('Choisissez un profil Claude ou Codex, ou déclarez une source dans collector.json.');
  }
  const eventUrl = `${origin}/api/monitor/events`;
  for (const profile of profiles) {
    try {
      const { changed } = installClaudeMonitor({ ...profile, url: eventUrl, replace: options['replace-hooks'] });
      log('Aperçu', `${changed ? 'Mettra à jour' : 'Déjà à jour'} · ${profile.settingsFile} · dataset ${dataset}`);
    } catch (error) {
      if (error.message.startsWith('A different Burn collector')) {
        throw new Error(`Hooks IA Burn différents dans ${profile.settingsFile}. Pour migrer les hooks du même dataset, ajoutez --replace-hooks.`);
      }
      throw error;
    }
  }

  const previousPlist = readFile(plistPath);
  const service = previousPlist ? JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '--', plistPath], { encoding: 'utf8' })) : {};
  const nextService = {
    ThrottleInterval: 15,
    StandardErrorPath: path.join(stateDir, 'collector.log'),
    ...service,
    Label: label,
    ProgramArguments: [stableNodePath(), path.join(root, 'scripts/collect-model-requests.mjs'), configPath],
    RunAtLoad: true,
    KeepAlive: true,
  };
  const serviceChanged = !isDeepStrictEqual(service, nextService);

  log('Aperçu', `Configuration du collecteur · ${configPath}`);
  log('Aperçu', `Service utilisateur · ${plistPath}`);
  for (const directory of captureDirectories) log('Aperçu', `Dossier privé de capture · ${directory}`);
  if (options.deploy) log('Aperçu', `Activation du récepteur Docker dans ${envPath} · port ${Number(port)}`);
  if (!options.apply) log('Aperçu', 'Ajoutez --apply pour exécuter ces actions.');
  if (!options.apply) return;

  const domain = `gui/${process.getuid()}`;
  execFileSync('/bin/launchctl', ['print', domain], { stdio: 'ignore' });
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  for (const directory of captureDirectories) {
    if (!existsSync(directory)) log('Modifie', `Création du dossier privé · ${directory}`);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (!isPrivateDirectory(directory)) throw new Error(`Le dossier de capture doit être privé · ${directory}`);
  }
  for (const profile of profiles) {
    log('Modifie', `Configuration des hooks ${profile.harness || 'claude'} · ${profile.settingsFile}`);
    const { applied, backup } = installClaudeMonitor({ ...profile, url: eventUrl, replace: options['replace-hooks'], apply: true });
    log('OK', applied ? `Profil configuré · ${profile.settingsFile}` : `Déjà à jour · ${profile.settingsFile}`);
    if (backup) log('OK', `Sauvegarde · ${backup}`);
  }

  if (options.deploy) {
    const previousEnv = readFile(envPath);
    const base = previousEnv ?? readFile(path.join(root, '.env.example'));
    const key = /^[ \t]*(?:export[ \t]+)?MONITOR_INGEST_ENABLED[ \t]*=.*$/gm;
    const nextEnv = base.match(key) ? base.replace(key, 'MONITOR_INGEST_ENABLED=1') : base.trimEnd() + '\nMONITOR_INGEST_ENABLED=1\n';
    updateFile(envPath, previousEnv, nextEnv);
    log('Modifie', `Déploiement du récepteur Docker · port ${Number(port)}`);
    execFileSync(path.join(root, 'deploy.sh'), ['--port', String(Number(port))], {
      cwd: root, env: { ...process.env, MONITOR_INGEST_ENABLED: '1' }, stdio: 'inherit',
    });
  }

  const nextConfig = JSON.stringify(config) === originalConfig ? previousConfig : JSON.stringify(config, null, 2) + '\n';
  const configChanged = updateFile(configPath, previousConfig, nextConfig);
  if (serviceChanged) {
    const plist = execFileSync('/usr/bin/plutil', ['-convert', 'xml1', '-o', '-', '--', '-'], {
      input: JSON.stringify(nextService), encoding: 'utf8',
    });
    updateFile(plistPath, previousPlist, plist);
  }
  const target = `${domain}/${label}`;
  const loaded = spawnSync('/bin/launchctl', ['print', target], { stdio: 'ignore' }).status === 0;
  if (!loaded || serviceChanged || configChanged) log('Modifie', `${loaded ? 'Redémarrage' : 'Chargement'} dans launchd · ${label}`);
  if (loaded && serviceChanged) execFileSync('/bin/launchctl', ['bootout', target]);
  if (!loaded || serviceChanged) execFileSync('/bin/launchctl', ['bootstrap', domain, plistPath]);
  else if (configChanged) execFileSync('/bin/launchctl', ['kickstart', '-k', target]);
  log('OK', `Collecteur chargé dans launchd · ${label}`);
  if (codexProfiles.length) log('OK', 'Approuvez les hooks Burn avec /hooks dans le CLI Codex.');
}

function isPrivateDirectory(directory) {
  const stat = lstatSync(directory);
  return stat.isDirectory() && stat.uid === process.getuid() && !(stat.mode & 0o077);
}

try {
  const { values } = parseArgs({ options: {
    apply: { type: 'boolean' }, deploy: { type: 'boolean' }, claude: { type: 'boolean' }, codex: { type: 'boolean' },
    'claude-profile': { type: 'string', multiple: true }, 'codex-profile': { type: 'string', multiple: true },
    'replace-hooks': { type: 'boolean' }, port: { type: 'string' },
    dataset: { type: 'string', default: 'personal' }, help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('node scripts/install-monitoring.mjs [--claude] [--codex] [--dataset personal|enterprise]\n' +
      '  [--claude-profile DOSSIER]... [--codex-profile DOSSIER]...\n' +
      '  [--replace-hooks] [--port PORT] [--deploy] [--apply]');
  } else run(values);
} catch (error) {
  log('Erreur', error.message, process.stderr);
  process.exitCode = 1;
}
