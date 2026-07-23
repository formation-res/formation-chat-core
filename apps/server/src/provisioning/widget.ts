import type { Insertable } from 'kysely';

import type { Database } from '../database/database.js';
import type { SiteWidgetAgentAlias, SiteWidgetTable } from '../database/types.js';

const PUBLIC_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;
const privateFieldNames = new Set([
  'agentSlug',
  'apiKey',
  'baseUrl',
  'connectorToken',
  'credential',
  'credentials',
  'haystackTenantKey',
  'model',
  'provider',
  'secret',
  'tenantKey',
  'token',
]);

export interface WidgetProvisioningConfig {
  tenant: {
    tenantId: string;
    displayName: string;
  };
  site: {
    siteId: string;
    siteKey: string;
    displayName: string;
    allowedOrigins: string[];
    agentRef?: string;
  };
  widget: {
    widgetId: string;
    widgetKey: string;
    displayName: string;
    version: string;
    theme: string;
    launcher: string;
    placement: string;
    defaultAgentAlias: string;
    agentAliases: SiteWidgetAgentAlias[];
  };
}

export class ProvisioningConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProvisioningConfigError';
  }
}

export class WorkerSiteExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkerSiteExportError';
  }
}

export async function provisionWidgetRegistry(
  database: Database,
  input: unknown,
): Promise<WidgetProvisioningConfig> {
  const config = parseWidgetProvisioningConfig(input);
  await database.transaction().execute(async (transaction) => {
    await transaction
      .insertInto('tenants')
      .values({
        tenant_id: config.tenant.tenantId,
        display_name: config.tenant.displayName,
      })
      .onConflict((conflict) =>
        conflict.column('tenant_id').doUpdateSet({ display_name: config.tenant.displayName }),
      )
      .execute();

    await transaction
      .insertInto('sites')
      .values({
        site_id: config.site.siteId,
        tenant_id: config.tenant.tenantId,
        site_key: config.site.siteKey,
        display_name: config.site.displayName,
        allowed_origins: JSON.stringify(config.site.allowedOrigins),
        agent_ref: config.site.agentRef as string,
      })
      .onConflict((conflict) =>
        conflict.column('site_key').doUpdateSet({
          display_name: config.site.displayName,
          allowed_origins: JSON.stringify(config.site.allowedOrigins),
          agent_ref: config.site.agentRef as string,
        }),
      )
      .execute();

    const widget: Insertable<SiteWidgetTable> = {
      widget_id: config.widget.widgetId,
      tenant_id: config.tenant.tenantId,
      site_id: config.site.siteId,
      widget_key: config.widget.widgetKey,
      display_name: config.widget.displayName,
      version: config.widget.version,
      theme: config.widget.theme,
      launcher: config.widget.launcher,
      placement: config.widget.placement,
      default_agent_alias: config.widget.defaultAgentAlias,
      agent_aliases: JSON.stringify(config.widget.agentAliases),
    };
    await transaction
      .insertInto('site_widgets')
      .values(widget)
      .onConflict((conflict) =>
        conflict.column('widget_key').doUpdateSet({
          display_name: config.widget.displayName,
          version: config.widget.version,
          theme: config.widget.theme,
          launcher: config.widget.launcher,
          placement: config.widget.placement,
          default_agent_alias: config.widget.defaultAgentAlias,
          agent_aliases: JSON.stringify(config.widget.agentAliases),
          updated_at: new Date(),
        }),
      )
      .execute();
  });
  return config;
}

export interface WorkerChatSites {
  [hostname: string]: {
    siteKey: string;
    allowedOrigins: string[];
    widget: {
      widgetKey: string;
      version: string;
      defaultAgent: string;
      theme: string;
      launcher: string;
      placement: string;
      agentAliases: Record<string, { siteKey: string; label: string }>;
    };
  };
}

export async function exportWorkerChatSites(database: Database): Promise<WorkerChatSites> {
  const rows = await database
    .selectFrom('site_widgets as widget')
    .innerJoin('sites as site', (join) =>
      join
        .onRef('site.tenant_id', '=', 'widget.tenant_id')
        .onRef('site.site_id', '=', 'widget.site_id'),
    )
    .select([
      'site.site_key',
      'site.allowed_origins',
      'widget.widget_key',
      'widget.version',
      'widget.theme',
      'widget.launcher',
      'widget.placement',
      'widget.default_agent_alias',
      'widget.agent_aliases',
    ])
    .orderBy('site.site_id')
    .orderBy('widget.widget_id')
    .execute();
  const sites: WorkerChatSites = {};
  for (const row of rows) {
    const allowedOrigins = normalizeStringArray(row.allowed_origins);
    const aliases = normalizeAgentAliases(row.agent_aliases);
    const workerAliases: Record<string, { siteKey: string; label: string }> = {};
    for (const alias of aliases) {
      workerAliases[alias.alias] = { siteKey: row.site_key, label: alias.label };
    }
    if (!workerAliases[row.default_agent_alias]) {
      throw new WorkerSiteExportError(`Widget ${row.widget_key} default alias is not configured.`);
    }
    for (const origin of allowedOrigins) {
      const hostname = hostnameForOrigin(origin);
      if (sites[hostname]) {
        throw new WorkerSiteExportError(`Multiple widgets target hostname ${hostname}.`);
      }
      sites[hostname] = {
        siteKey: row.site_key,
        allowedOrigins,
        widget: {
          widgetKey: row.widget_key,
          version: row.version,
          defaultAgent: row.default_agent_alias,
          theme: row.theme,
          launcher: row.launcher,
          placement: row.placement,
          agentAliases: workerAliases,
        },
      };
    }
  }
  return sites;
}

export function parseWidgetProvisioningConfig(input: unknown): WidgetProvisioningConfig {
  rejectPrivateFields(input);
  if (!isRecord(input)) throw new ProvisioningConfigError('Config must be an object.');
  const tenant = parseTenant(input.tenant);
  const site = parseSite(input.site);
  const widget = parseWidget(input.widget);
  const defaultAlias = widget.agentAliases.find(
    (alias) => alias.alias === widget.defaultAgentAlias,
  );
  if (!defaultAlias) {
    throw new ProvisioningConfigError('defaultAgentAlias must match one configured public alias.');
  }
  return { tenant, site: { ...site, agentRef: defaultAlias.agentRef }, widget };
}

function parseTenant(input: unknown): WidgetProvisioningConfig['tenant'] {
  if (!isRecord(input)) throw new ProvisioningConfigError('tenant must be an object.');
  return {
    tenantId: publicToken(input.tenantId, 'tenant.tenantId'),
    displayName: displayText(input.displayName, 'tenant.displayName', 200),
  };
}

function parseSite(input: unknown): Omit<WidgetProvisioningConfig['site'], 'agentRef'> {
  if (!isRecord(input)) throw new ProvisioningConfigError('site must be an object.');
  const allowedOrigins = arrayOf(input.allowedOrigins, 'site.allowedOrigins', (value, label) =>
    exactHttpsOrigin(value, label),
  );
  if (allowedOrigins.length === 0 || allowedOrigins.length > 20) {
    throw new ProvisioningConfigError('site.allowedOrigins must contain 1 to 20 origins.');
  }
  return {
    siteId: publicToken(input.siteId, 'site.siteId'),
    siteKey: publicToken(input.siteKey, 'site.siteKey'),
    displayName: displayText(input.displayName, 'site.displayName', 200),
    allowedOrigins,
  };
}

function parseWidget(input: unknown): WidgetProvisioningConfig['widget'] {
  if (!isRecord(input)) throw new ProvisioningConfigError('widget must be an object.');
  const agentAliases = arrayOf(input.agentAliases, 'widget.agentAliases', parseAgentAlias);
  if (agentAliases.length === 0 || agentAliases.length > 20) {
    throw new ProvisioningConfigError('widget.agentAliases must contain 1 to 20 aliases.');
  }
  if (new Set(agentAliases.map((alias) => alias.alias)).size !== agentAliases.length) {
    throw new ProvisioningConfigError('widget.agentAliases must be unique.');
  }
  return {
    widgetId: publicToken(input.widgetId, 'widget.widgetId'),
    widgetKey: publicToken(input.widgetKey, 'widget.widgetKey'),
    displayName: displayText(input.displayName, 'widget.displayName', 200),
    version: publicToken(input.version, 'widget.version'),
    theme: publicToken(input.theme, 'widget.theme'),
    launcher: publicToken(input.launcher, 'widget.launcher'),
    placement: publicToken(input.placement, 'widget.placement'),
    defaultAgentAlias: publicToken(input.defaultAgentAlias, 'widget.defaultAgentAlias'),
    agentAliases,
  };
}

function parseAgentAlias(input: unknown, label: string): SiteWidgetAgentAlias {
  if (!isRecord(input)) throw new ProvisioningConfigError(`${label} must be an object.`);
  return {
    alias: publicToken(input.alias, `${label}.alias`),
    label: displayText(input.label, `${label}.label`, 80),
    agentRef: publicToken(input.agentRef, `${label}.agentRef`),
  };
}

function rejectPrivateFields(input: unknown, path = 'config'): void {
  if (Array.isArray(input)) {
    input.forEach((value, index) => rejectPrivateFields(value, `${path}[${index}]`));
    return;
  }
  if (!isRecord(input)) return;
  for (const [key, value] of Object.entries(input)) {
    if (privateFieldNames.has(key)) {
      throw new ProvisioningConfigError(`${path}.${key} is private connector wiring.`);
    }
    rejectPrivateFields(value, `${path}.${key}`);
  }
}

function arrayOf<T>(
  input: unknown,
  label: string,
  parser: (value: unknown, label: string) => T,
): T[] {
  if (!Array.isArray(input)) throw new ProvisioningConfigError(`${label} must be an array.`);
  return input.map((value, index) => parser(value, `${label}[${index}]`));
}

function publicToken(input: unknown, label: string): string {
  if (typeof input !== 'string' || !PUBLIC_TOKEN.test(input)) {
    throw new ProvisioningConfigError(`${label} must be a public token.`);
  }
  return input;
}

function displayText(input: unknown, label: string, maxLength: number): string {
  if (typeof input !== 'string' || input.trim().length === 0 || input.length > maxLength) {
    throw new ProvisioningConfigError(`${label} must be non-empty text.`);
  }
  return input;
}

function exactHttpsOrigin(input: unknown, label: string): string {
  if (typeof input !== 'string') throw new ProvisioningConfigError(`${label} must be an origin.`);
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' || url.origin !== input) {
      throw new ProvisioningConfigError(`${label} must be an exact HTTPS origin.`);
    }
    return url.origin;
  } catch (error) {
    if (error instanceof ProvisioningConfigError) throw error;
    throw new ProvisioningConfigError(`${label} must be an exact HTTPS origin.`);
  }
}

function hostnameForOrigin(origin: string): string {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.origin !== origin) {
      throw new WorkerSiteExportError(`Invalid origin ${origin}.`);
    }
    return url.hostname.toLowerCase();
  } catch (error) {
    if (error instanceof WorkerSiteExportError) throw error;
    throw new WorkerSiteExportError(`Invalid origin ${origin}.`);
  }
}

function normalizeStringArray(value: string[] | string): string[] {
  return Array.isArray(value) ? value : (JSON.parse(value) as string[]);
}

function normalizeAgentAliases(value: SiteWidgetAgentAlias[] | string): SiteWidgetAgentAlias[] {
  return Array.isArray(value) ? value : (JSON.parse(value) as SiteWidgetAgentAlias[]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
