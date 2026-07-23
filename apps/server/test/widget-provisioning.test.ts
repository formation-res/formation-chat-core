import { describe, expect, it } from 'vitest';

import {
  parseWidgetProvisioningConfig,
  ProvisioningConfigError,
} from '../src/provisioning/widget.js';

const validConfig = {
  tenant: { tenantId: 'tenant-one', displayName: 'Tenant One' },
  site: {
    siteId: 'site-one',
    siteKey: 'site-one-key',
    displayName: 'Main website',
    allowedOrigins: ['https://www.example.com'],
  },
  widget: {
    widgetId: 'widget-one',
    widgetKey: 'main-chat',
    displayName: 'Main chat',
    version: '2026-07-23',
    theme: 'earth',
    launcher: 'agent',
    placement: 'bottom-right',
    defaultAgentAlias: 'support',
    agentAliases: [{ alias: 'support', label: 'Support', agentRef: 'support-agent' }],
  },
};

describe('widget provisioning config', () => {
  it('accepts a public widget registry config and derives the default site agent', () => {
    expect(parseWidgetProvisioningConfig(validConfig)).toEqual({
      ...validConfig,
      site: { ...validConfig.site, agentRef: 'support-agent' },
    });
  });

  it('rejects private connector wiring in public widget config', () => {
    expect(() =>
      parseWidgetProvisioningConfig({
        ...validConfig,
        widget: {
          ...validConfig.widget,
          agentAliases: [
            {
              alias: 'support',
              label: 'Support',
              agentRef: 'support-agent',
              baseUrl: 'https://haystack.example.com',
            },
          ],
        },
      }),
    ).toThrow(ProvisioningConfigError);
  });

  it('requires the default alias to exist in the widget alias list', () => {
    expect(() =>
      parseWidgetProvisioningConfig({
        ...validConfig,
        widget: { ...validConfig.widget, defaultAgentAlias: 'sales' },
      }),
    ).toThrow('defaultAgentAlias must match one configured public alias');
  });
});
