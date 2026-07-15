# Conversation events

`GET /v1/conversations/{conversationId}/events` opens an SSE stream. The request requires the
session bearer token and its `events:read` scope. The token must match the conversation's tenant,
site, and principal.

Each frame contains the stable event ID, event type, and full public event envelope:

```text
id: 019f...
event: message.delta
data: {"eventId":"019f...","sequence":4,"type":"message.delta",...}
```

The stream sends retained public events in sequence order and then stays open for live events.
Operator and internal events are stored but never sent through this endpoint.

## Reconnect and recovery

Send the last received event ID in the `Last-Event-ID` header when reconnecting. The server starts
after that event, so the cursor event is not duplicated. A subscriber that connects during a write
receives the event once, either from replay or from the live queue.

The server sends `sync.required` and closes the stream when the cursor is no longer retained. Fetch
the conversation and its messages through the normal query endpoints, then open a new stream
without the expired cursor. Message records are the canonical snapshot and remain available when
transient events have been pruned.

## Retention and backpressure

`EVENT_RETENTION_MAX_EVENTS` sets the maximum stored events per conversation. Its default is 1000;
valid values range from 1 to 1,000,000.

Each live subscriber has a bounded queue. `EVENT_SUBSCRIBER_BUFFER_SIZE` sets its capacity. Its
default is 100; valid values range from 1 to 10,000. If a client falls behind, the server detaches
that subscriber and sends `sync.required` when the connection can accept another frame. Database
writes and event producers do not wait for the network client.
