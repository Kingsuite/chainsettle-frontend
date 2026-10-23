# Contributing to ChainSettle Frontend

Thanks for helping improve ChainSettle. Please follow this guide when setting up the project and opening a pull request.

## Local setup

1. Install [Node.js 20 or later](https://nodejs.org/) and npm.
2. Clone the repository, then install dependencies:

   ```bash
   npm install
   ```

3. Copy `.env.example` to `.env.local` and provide the required values. In particular, use a deployed **testnet** contract ID and the testnet RPC and Horizon endpoints. Keep `.env.local` private; never commit secrets or local credentials.
4. Install the [Freighter](https://www.freighter.app/) browser extension and select **Testnet** in its network settings.
5. To fund a testnet account, copy its public address from Freighter and request test XLM from [Stellar Friendbot](https://friendbot.stellar.org/?addr=YOUR_PUBLIC_KEY). Friendbot funds testnet accounts only; test XLM has no monetary value.
6. Start the frontend:

   ```bash
   npm run dev
   ```

The development server uses the backend URL configured in `.env.local` (or `http://localhost:3000/api/v1` by default).

## Branches and commits

Create a focused branch from the current default branch. Use a type prefix and a short, lowercase, hyphen-separated description, for example:

- `feat/add-shipment-search`
- `fix/wallet-network-warning`
- `docs/update-setup-guide`

Write commit messages using [Conventional Commits](https://www.conventionalcommits.org/):

```text
<type>(optional-scope): <short imperative summary>
```

For example: `feat(shipments): add status filtering`. Common types include `feat`, `fix`, `docs`, `refactor`, `test`, and `chore`.

## Checks before opening a pull request

Run all of the following from the repository root and resolve any failures:

```bash
npm run lint
npx tsc --noEmit
npm run build
```

The build validates environment variables at build time. Make sure your local `.env.local` has valid values before running it.

## UI text and translations

Do not hard-code user-facing strings in components. Add or update messages in `src/i18n/messages/en.json` and use the existing `next-intl` translation patterns so UI text remains translatable.

## Pull requests

- Keep each pull request focused and describe the user-visible change and its motivation.
- Link the related issue when one exists.
- Complete the checklist in the pull request template and report the checks you ran.
- For UI changes, include screenshots of the affected states. Include desktop and mobile screenshots when the layout or interaction changes at different viewport sizes.
- Do not include `.env.local`, credentials, generated files, or unrelated formatting changes.
