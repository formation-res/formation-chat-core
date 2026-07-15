import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';

import {
  CursorPageSchema,
  ErrorEnvelopeSchema,
  EventEnvelopeSchema,
  IdempotencyMetadataSchema,
  OpaqueIdSchema,
  TimestampSchema,
} from '../src/index.js';

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);

describe('common protocol schemas', () => {
  it('accepts opaque identifiers and rejects whitespace-bearing identifiers', () => {
    const validate = ajv.compile(OpaqueIdSchema);

    expect(validate('conversation_01JY5N7P8Q')).toBe(true);
    expect(validate('conversation id')).toBe(false);
  });

  it('requires RFC 3339 UTC timestamps', () => {
    const validate = ajv.compile(TimestampSchema);

    expect(validate('2026-07-15T12:30:45.123Z')).toBe(true);
    expect(validate('2026-07-15T14:30:45.123+02:00')).toBe(false);
  });

  it('validates cursor pagination metadata', () => {
    const validate = ajv.compile(CursorPageSchema);

    expect(validate({ hasMore: true, nextCursor: 'eyJzZXF1ZW5jZSI6NDJ9' })).toBe(true);
    expect(validate({ hasMore: false })).toBe(true);
    expect(validate({ hasMore: true })).toBe(false);
  });

  it('uses one stable safe error envelope', () => {
    const validate = ajv.compile(ErrorEnvelopeSchema);

    expect(
      validate({
        error: {
          code: 'INVALID_REQUEST',
          message: 'The request is invalid.',
          correlationId: 'request_01JY5N7P8Q',
          fieldErrors: [{ field: 'message', code: 'REQUIRED', message: 'Required.' }],
        },
      }),
    ).toBe(true);
    expect(validate({ error: { code: 'bad', message: 'No correlation identifier' } })).toBe(false);
  });

  it('validates idempotency keys and optional request hashes', () => {
    const validate = ajv.compile(IdempotencyMetadataSchema);

    expect(validate({ idempotencyKey: 'msg-submit_01JY5N7P8Q' })).toBe(true);
    expect(validate({ idempotencyKey: '' })).toBe(false);
  });

  it('requires ordered, explicitly visible event metadata', () => {
    const validate = ajv.compile(EventEnvelopeSchema);
    const event = {
      eventId: 'event_01JY5N7P8Q',
      sequence: 1,
      type: 'message.delta',
      occurredAt: '2026-07-15T12:30:45.123Z',
      visibility: 'public',
      conversationId: 'conversation_01JY5N7P8Q',
      runId: 'run_01JY5N7P8Q',
      messageId: 'message_01JY5N7P8Q',
      futureField: 'ignored by compatible readers',
    };

    expect(validate(event)).toBe(true);
    expect(validate({ ...event, sequence: 0 })).toBe(false);
    expect(validate({ ...event, visibility: 'private' })).toBe(false);
  });
});
