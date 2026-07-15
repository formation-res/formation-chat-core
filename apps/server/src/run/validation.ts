import { ConnectorEventSchema, type ConnectorEvent } from '@formation-chat-core/protocol';
import { FormatRegistry } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

if (!FormatRegistry.Has('uri')) {
  FormatRegistry.Set('uri', (value) => {
    try {
      return new URL(value).protocol === 'https:';
    } catch {
      return false;
    }
  });
}

export function isConnectorEvent(value: unknown): value is ConnectorEvent {
  return Value.Check(ConnectorEventSchema, value);
}
