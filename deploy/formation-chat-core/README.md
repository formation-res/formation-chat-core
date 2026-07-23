# Formation Chat Core deployment

These files mirror the Formation Haystack deployment shape for the `clawd` host.

Install once on the server:

```sh
sudo mkdir -p /etc/docker-compose/formation-chat-core
sudo cp docker-compose.yml /etc/docker-compose/formation-chat-core/docker-compose.yml
sudo cp formation-chat-core.service /etc/systemd/system/formation-chat-core.service
sudo cp integrity.sh /opt/formation/integrity.d/57-formation-chat-core
sudo chmod 0755 /opt/formation/integrity.d/57-formation-chat-core
sudo systemctl daemon-reload
sudo systemctl enable formation-chat-core
```

Create `/etc/docker-compose/formation-chat-core/.env` with production secrets and connector
settings. Required values:

```sh
POSTGRES_PASSWORD=
SESSION_TOKEN_SECRET=
ADMIN_TOKEN_SECRET=
HAYSTACK_CONNECTORS=
```

`SESSION_TOKEN_SECRET` and `ADMIN_TOKEN_SECRET` must each be at least 32 bytes. `HAYSTACK_CONNECTORS`
is the Chat Core connector map JSON for the deployed Haystack agent endpoint, for example:

```json
{
  "mailfront": {
    "baseUrl": "https://haystack.formationxyz.com",
    "tenantKey": "formation",
    "agentSlug": "mailfront",
    "responseMode": "support_chat"
  }
}
```

The default public bind is `127.0.0.1:13000`. Point the reverse proxy for
`chat-core.formationxyz.com` at that port and expose only HTTPS publicly.
