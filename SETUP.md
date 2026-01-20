# Setup

netjsonmon requires Node.js 20+ and npm.

## Install Node.js and npm

Choose one of the options below.

### Option A: Node.js website (recommended)

1. Download the LTS installer from https://nodejs.org/
2. Run the installer and accept defaults.
3. Open a new terminal and verify:

```bash
node -v
npm -v
```

### Option B: Homebrew (macOS)

```bash
brew install node
node -v
npm -v
```

### Option C: Linux (Debian/Ubuntu)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v
npm -v
```

## Install project dependencies

From the repo root:

```bash
npm install
npm run build
npm link
```

If Playwright browsers are missing, install them:

```bash
npx playwright install
```
