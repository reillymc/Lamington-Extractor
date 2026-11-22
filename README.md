# Lamington Extractor

Recipe extraction service for Lamington. It fetches untrusted recipe pages, parses JSON-LD recipe data and returns a normalized recipe payload.

## Development

Install dependencies and create a local environment file:

```sh
npm ci
cp .env.example .env
npm start
```

The service listens on port `3001` by default.

## API

In production, `EXTRACTOR_API_KEY` is required. A high-entropy key is strongly recommended. Requests must include:

```text
Authorization: Bearer <key>
```

Generate a key with 32 random bytes:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
# or:
openssl rand -hex 32
```

## Deployment

The service is published as:

```text
ghcr.io/reillymc/lamington-extractor
```

Configuration is documented in `.env.example`.

## License

Copyright (C) 2025 Reilly MacKenzie-Cree.

This project is licensed under the GNU General Public License, version 3 or
later (`GPL-3.0-or-later`). See [`LICENCE`](./LICENCE).
